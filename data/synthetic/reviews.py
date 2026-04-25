"""
Review generator. Target 2,500 reviews for 250 SKUs (~10 reviews/SKU).

Run:  python -m data.synthetic.reviews [--limit N] [--dry-run] [--resume]
Output: data/output/reviews.ndjson

Distribution:
- 70% positive / 20% neutral / 10% negative (rating 4-5 / 3 / 1-2)
- Each review attached to a persona (1..40); wow personas reviewed
  proportionally more on their target SKUs to support scenario A/B narrative.
- Korean text 50-300 chars, natural retail review tone
- Batch size 25 reviews per Bedrock call
"""
from __future__ import annotations

import argparse
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Set, Tuple

from pydantic import ValidationError

from data.schemas import Persona, Product, Review
from data.synthetic._bedrock import array_tool_schema, call_with_tool

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "output" / "reviews.ndjson"
PERSONAS_NDJSON = Path(__file__).resolve().parents[1] / "output" / "personas.ndjson"
PRODUCTS_NDJSON = Path(__file__).resolve().parents[1] / "output" / "products.ndjson"


SYSTEM_PROMPT = (
    "당신은 한국 온라인 쇼핑몰 리뷰를 작성하는 다양한 소비자 화자(voice)를 시뮬레이션합니다. "
    "각 리뷰는 SKU와 작성 페르소나의 라이프스타일·관심사가 자연스럽게 드러나야 하며, "
    "실제 쿠팡·올리브영·마켓컬리에서 보이는 한국어 리뷰 톤을 유지합니다. "
    "PII, 의약 효능 단언, 경쟁사 비방은 금지."
)


def _load_ndjson(path: Path, model):
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Generate prerequisites first "
            f"(personas / products via their respective scripts)."
        )
    items = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                items.append(model(**json.loads(line)))
    return items


def _allocate_reviews(products: List[Product], personas: List[Persona], total: int,
                     reviews_per_sku: int = 10) -> List[Tuple[str, str, str]]:
    """Return list of (sku_id, persona_id, sentiment) tuples to generate."""
    rng = random.Random(7)
    wow_personas = [p for p in personas if p.is_wow]
    other_personas = [p for p in personas if not p.is_wow]
    pairs: List[Tuple[str, str, str]] = []
    sentiments = ["positive"] * 7 + ["neutral"] * 2 + ["negative"]
    for product in products:
        for _ in range(reviews_per_sku):
            if product.is_wow and wow_personas and rng.random() < 0.4:
                persona = rng.choice(wow_personas)
            else:
                persona = rng.choice(other_personas or personas)
            pairs.append((product.sku_id, persona.persona_id, rng.choice(sentiments)))
            if len(pairs) >= total:
                return pairs
    return pairs


def _user_prompt(*, start_idx: int, batch: List[Tuple[str, str, str]],
                 sku_lookup: Dict[str, Product], persona_lookup: Dict[str, Persona]) -> str:
    lines = []
    for offset, (sku_id, persona_id, sentiment) in enumerate(batch):
        sku = sku_lookup[sku_id]
        persona = persona_lookup[persona_id]
        lines.append(
            f"- review_id=rev_{start_idx + offset:06d}  sku={sku.sku_id} '{sku.name_ko}' "
            f"persona={persona.persona_id} '{persona.label_ko}' sentiment={sentiment}"
        )
    return (
        f"다음 {len(batch)}개 리뷰를 생성하세요. 각 줄은 한 리뷰 명세입니다:\n"
        + "\n".join(lines)
        + "\n\n요구사항:\n"
        "- review_id, sku_id, persona_id, sentiment는 위 명세 그대로 사용\n"
        "- rating: positive=4 또는 5, neutral=3, negative=1 또는 2\n"
        "- title_ko: 10자 내외 짧은 한 줄 요약 (생략 가능)\n"
        "- body_ko: 50-300자 한국어. 페르소나의 라이프스타일·관심사가 자연스럽게 드러나게.\n"
        "  positive는 구체적 만족 포인트, neutral은 양가, negative는 합리적 불만.\n"
        "- helpful_count: 0-200 사이 정수 (대부분 0-30)\n"
        "- review_date: 2025-01-01 ~ 2026-04-20 사이 ISO 형식 (YYYY-MM-DD)\n"
    )


def generate(*, total: int = 2500, reviews_per_sku: int = 10,
             batch_size: int = 25, dry_run: bool = False, resume: bool = True) -> None:
    personas = _load_ndjson(PERSONAS_NDJSON, Persona)
    products = _load_ndjson(PRODUCTS_NDJSON, Product)
    print(f"  loaded {len(personas)} personas, {len(products)} products")

    plan = _allocate_reviews(products, personas, total, reviews_per_sku)
    print(f"  allocated {len(plan)} reviews")

    existing_ids: Set[str] = set()
    if resume and OUTPUT_PATH.exists():
        with OUTPUT_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    existing_ids.add(json.loads(line)["review_id"])
        print(f"  resume: {len(existing_ids)} existing reviews")

    sku_lookup = {p.sku_id: p for p in products}
    persona_lookup = {p.persona_id: p for p in personas}

    if dry_run:
        n_calls = math.ceil(len(plan) / batch_size)
        print(f"[dry-run] {len(plan)} reviews across {n_calls} Bedrock calls")
        return

    next_idx = max((int(r.replace("rev_", "")) for r in existing_ids), default=0) + 1
    if existing_ids:
        plan = plan[len(existing_ids):]

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    while plan:
        batch = plan[:batch_size]
        plan = plan[batch_size:]
        prompt = _user_prompt(start_idx=next_idx, batch=batch,
                              sku_lookup=sku_lookup, persona_lookup=persona_lookup)
        tool_schema = array_tool_schema(
            Review.model_json_schema(), min_items=1, max_items=len(batch)
        )
        print(f"  → reviews {next_idx}..{next_idx + len(batch) - 1}  ({len(plan)} remaining)")
        result = call_with_tool(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=prompt,
            tool_name="save_reviews",
            tool_description="Save the generated review batch.",
            input_schema=tool_schema,
            temperature=0.9,
            max_tokens=8192,
        )
        added = 0
        for raw in result.get("items", []):
            try:
                if isinstance(raw.get("review_date"), str):
                    raw["review_date"] = date.fromisoformat(raw["review_date"])
                r = Review(**raw)
                with OUTPUT_PATH.open("a", encoding="utf-8") as f:
                    f.write(r.model_dump_json(exclude_none=True) + "\n")
                added += 1
            except ValidationError as e:
                print(f"    ! skip invalid review: {e.errors()[0]['msg']}")
        next_idx += added
        if added == 0:
            print(f"    ! no valid items, skipping batch to avoid infinite loop")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=2500)
    parser.add_argument("--reviews-per-sku", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    if args.no_resume and OUTPUT_PATH.exists():
        OUTPUT_PATH.unlink()

    generate(
        total=args.limit,
        reviews_per_sku=args.reviews_per_sku,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        resume=not args.no_resume,
    )


if __name__ == "__main__":
    main()
