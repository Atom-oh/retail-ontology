"""
Product (SKU) generator. 250 SKUs total = 125 grocery + 125 beauty.

Run:  python -m data.synthetic.products [--limit N] [--dry-run] [--resume]
Output: data/output/products.ndjson

Strategy:
- Categories distribution from Phase 0 GS1↔KFDA mapping CSV
- Brands from data/synthetic/deterministic.py (must run first)
- 30 wow SKUs are tagged is_wow=True via post-processing rules
- LLM generates 8-10 SKUs per call (smaller batch → tighter prompt control)
"""
from __future__ import annotations

import argparse
import json
import math
import random
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Set

from pydantic import ValidationError

from data.public.beauty_categories import load_beauty_categories
from data.public.inci import load_inci_ingredients
from data.public.kfda import load_categories
from data.schemas import Brand, Category, Product
from data.synthetic._bedrock import array_tool_schema, call_with_tool

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "output" / "products.ndjson"
BRANDS_JSON = Path(__file__).resolve().parents[1] / "output" / "brands.json"


SYSTEM_PROMPT = (
    "당신은 한국 Retail/CPG 카탈로그를 데이터 디자이너입니다. "
    "한국 편의점·마트·올리브영에서 실제 팔릴 법한 SKU를 생성하되, "
    "데모 데이터임을 인지하고 합리적인 가격대(KRW)와 자연스러운 한국어 상품명을 사용합니다. "
    "PII나 상품 안전 주장은 포함하지 않습니다."
)


def _load_brands() -> List[Brand]:
    if not BRANDS_JSON.exists():
        raise FileNotFoundError(
            f"{BRANDS_JSON} not found. Run `python -m data.synthetic.deterministic` first."
        )
    raw = json.loads(BRANDS_JSON.read_text(encoding="utf-8"))
    return [Brand(**b) for b in raw]


def _plan_distribution(categories: List[Category], target: int, domain: str) -> Dict[str, int]:
    """Allocate `target` SKUs across categories belonging to `domain`.

    Grocery domain pulls from GS1 GPC bricks (food sub-domains: beverage, snack,
    dairy, etc.). Beauty domain pulls from the curated `bty_*` taxonomy.
    """
    if domain == "beauty":
        pool = [c for c in categories if c.domain == "beauty"]
    else:
        pool = [c for c in categories if c.domain != "beauty"]
    if not pool:
        return {}
    base = target // len(pool)
    extras = target % len(pool)
    rng = random.Random(42)
    extra_codes = set(rng.sample([c.gs1_brick_code for c in pool], k=min(extras, len(pool))))
    return {c.gs1_brick_code: base + (1 if c.gs1_brick_code in extra_codes else 0) for c in pool}


def _user_prompt(*, start_idx: int, count: int, brick_code: str, brick_name: str,
                 retail_label: str, brands_for_brick: List[Brand], domain: str) -> str:
    brand_list = "\n".join(f"  - {b.brand_id} {b.name_ko} ({b.positioning_ko or ''})" for b in brands_for_brick)
    domain_hint = (
        "그로서리(편의점/마트 식품) — nutrients 컬럼은 칼로리·당류·단백질·나트륨 등 핵심 영양소를 1-3개 포함하세요."
        if domain == "grocery"
        else "뷰티(스킨케어/메이크업/바디) — nutrients는 비워두고 ingredients에 INCI 성분 3-6개를 포함하세요."
    )
    return (
        f"GS1 카테고리 {brick_code} ({brick_name}, 한국명 '{retail_label}')에 속하는 "
        f"한국 SKU {count}개를 생성하세요.\n\n"
        f"도메인: {domain} — {domain_hint}\n\n"
        f"sku_id는 prd_{start_idx:04d}부터 prd_{start_idx + count - 1:04d}까지.\n"
        f"gs1_brick_code: '{brick_code}' (모두 동일).\n"
        f"domain: '{domain}' (모두 동일).\n\n"
        f"사용 가능한 brand_id (이 중에서 선택):\n{brand_list}\n\n"
        f"기타:\n"
        f"- name_ko: 한국에서 자연스러운 상품명 (예: '서울우유 저지방 1L', '시카 진정 토너 200ml')\n"
        f"- price_krw: 카테고리 평균에 맞는 정수 (예: 음료 1500-3500, 라면 1000-2000, 화장품 8000-50000)\n"
        f"- volume + unit: 적절한 용량과 단위 (ml/g/ea)\n"
        f"- claims_ko: 0-3개 (예: ['비건', '글루텐프리', '향료무첨가'])\n"
        f"- target_concern_ids: 0-2개 (예: ['con_01'] 민감성, ['con_16'] 임산부친화, ['con_15'] 고단백)\n"
        f"- description_ko: 1-2문장의 마케팅 설명\n"
        f"- ingredients[].ingredient_id: inci: 또는 foodon: prefix (뷰티는 INCI ID 권장)\n"
        f"- nutrients[].nutrient_id: ntr:calorie, ntr:sugar, ntr:protein, ntr:sodium 등\n"
        f"- is_wow는 false로 둡니다 (post-processing에서 표시).\n"
    )


def generate(
    *,
    total_grocery: int = 125,
    total_beauty: int = 125,
    batch_size: int = 8,
    dry_run: bool = False,
    resume: bool = True,
) -> List[Product]:
    cats = load_categories() + load_beauty_categories()
    brands = _load_brands()
    brands_by_domain: Dict[str, List[Brand]] = defaultdict(list)
    for b in brands:
        brands_by_domain[b.domain].append(b)

    plans = {
        "grocery": _plan_distribution(cats, total_grocery, "grocery"),
        "beauty": _plan_distribution(cats, total_beauty, "beauty"),
    }

    existing_ids: Set[str] = set()
    out: List[Product] = []
    if resume and OUTPUT_PATH.exists():
        with OUTPUT_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    obj = json.loads(line)
                    out.append(Product(**obj))
                    existing_ids.add(obj["sku_id"])
        print(f"  resume: {len(existing_ids)} existing SKUs")

    if dry_run:
        total_plan = sum(plans["grocery"].values()) + sum(plans["beauty"].values())
        n_calls = math.ceil(total_plan / batch_size)
        print(f"[dry-run] {total_plan} SKUs across {n_calls} Bedrock calls")
        for domain, plan in plans.items():
            print(f"  {domain}: {sum(plan.values())} SKUs")
        return []

    next_idx = max((int(s.replace("prd_", "")) for s in existing_ids), default=0) + 1
    cat_by_code = {c.gs1_brick_code: c for c in cats}

    for domain, plan in plans.items():
        domain_brands = brands_by_domain[domain] or brands
        for brick_code, count in plan.items():
            if count == 0:
                continue
            cat = cat_by_code[brick_code]
            cat_brands = [b for b in domain_brands]  # any brand in this domain may sell this category
            remaining = count
            while remaining > 0:
                this_batch = min(batch_size, remaining)
                prompt = _user_prompt(
                    start_idx=next_idx,
                    count=this_batch,
                    brick_code=brick_code,
                    brick_name=cat.gs1_brick_name_en,
                    retail_label=cat.retail_category_ko,
                    brands_for_brick=cat_brands[:8],
                    domain=domain,
                )
                tool_schema = array_tool_schema(
                    Product.model_json_schema(), min_items=1, max_items=this_batch
                )
                print(f"  → SKUs {next_idx}..{next_idx + this_batch - 1} ({domain}/{cat.retail_category_ko})")
                result = call_with_tool(
                    system_prompt=SYSTEM_PROMPT,
                    user_prompt=prompt,
                    tool_name="save_products",
                    tool_description="Save the generated SKU batch.",
                    input_schema=tool_schema,
                    temperature=0.8,
                )
                added = 0
                for raw in result.get("items", []):
                    try:
                        raw["sku_id"] = f"prd_{next_idx + added:04d}"
                        raw["gs1_brick_code"] = brick_code
                        raw["domain"] = domain
                        raw["is_wow"] = False
                        p = Product(**raw)
                        out.append(p)
                        with OUTPUT_PATH.open("a", encoding="utf-8") as f:
                            f.write(p.model_dump_json(exclude_none=True) + "\n")
                        added += 1
                        if added >= this_batch:
                            break
                    except ValidationError as e:
                        print(f"    ! skip invalid SKU: {e.errors()[0]['msg']}")
                next_idx += added
                remaining -= added
                if added == 0:
                    print(f"    ! no valid items returned, advancing 1 to avoid infinite loop")
                    next_idx += 1
                    remaining -= 1

    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-grocery", type=int, default=125)
    parser.add_argument("--limit-beauty", type=int, default=125)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if args.no_resume and OUTPUT_PATH.exists():
        OUTPUT_PATH.unlink()

    generate(
        total_grocery=args.limit_grocery,
        total_beauty=args.limit_beauty,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        resume=not args.no_resume,
    )


if __name__ == "__main__":
    main()
