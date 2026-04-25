"""
Persona generator. 5 wow personas hardcoded + 35 LLM-generated = 40 total.

Run:  python -m data.synthetic.personas [--limit N] [--dry-run]
Output: data/output/personas.ndjson
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List

from pydantic import ValidationError

from data.schemas import Persona
from data.synthetic._bedrock import array_tool_schema, call_with_tool

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "output" / "personas.ndjson"
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# Wow personas (5) — hardcoded for narrative consistency in scenarios A/B/C
# These directly drive the wow demo queries (spec § 4.1, § 4.2, § 4.3).
# --------------------------------------------------------------------------
WOW_PERSONAS: List[Persona] = [
    Persona(
        persona_id="psn_001",
        label_ko="임산부 6개월 32세",
        age=32,
        gender="F",
        life_stage_ko="임신 6개월",
        occupation_ko="IT 회사 마케터 (재택근무)",
        concern_ids=["con_16", "con_20", "con_03", "con_01"],
        preferred_ingredient_ids=[
            "inci:bakuchiol",
            "inci:zinc-oxide",
            "inci:hyaluronic-acid",
            "inci:centella-asiatica-extract",
        ],
        avoided_ingredient_ids=[
            "inci:retinol",
            "inci:retinyl-palmitate",
            "inci:salicylic-acid",
            "ntr:caffeine",
            "ntr:alcohol",
        ],
        favorite_brick_codes=["10000066", "10000148", "10001400"],
        narrative_ko=(
            "임신 중기에 들어 호르몬 변화로 피부가 예민해지고, 카페인·알코올을 완전히 끊었다. "
            "온라인에서 임산부 친화 성분만 찾아보는 데 지쳐서 '한 번에 안전한 것만 보여주는 검색'을 원한다. "
            "쇼핑은 컬리·올리브영을 주로 이용한다."
        ),
        is_wow=True,
    ),
    Persona(
        persona_id="psn_002",
        label_ko="38세 워킹맘 (4세 글루텐알레르기)",
        age=38,
        gender="F",
        life_stage_ko="육아중 (자녀 4세)",
        occupation_ko="대기업 직장맘",
        concern_ids=["con_12", "con_17", "con_19"],
        preferred_ingredient_ids=[],
        avoided_ingredient_ids=[],
        favorite_brick_codes=["10001401", "10001500", "10000148", "10000066"],
        narrative_ko=(
            "첫째가 4살 글루텐 알레르기 진단을 받은 뒤, 모든 간식을 라벨로 검수한다. "
            "시간이 부족해 '글루텐프리·100kcal 이하·아이가 좋아하는 맛' 세 조건이 동시에 걸린 추천을 원한다. "
            "이마트와 마켓컬리를 번갈아 사용한다."
        ),
        is_wow=True,
    ),
    Persona(
        persona_id="psn_003",
        label_ko="20대 민감성 피부 직장인",
        age=24,
        gender="F",
        life_stage_ko="사회초년생",
        occupation_ko="신입 디자이너",
        concern_ids=["con_01", "con_08", "con_05"],
        preferred_ingredient_ids=[
            "inci:centella-asiatica-extract",
            "inci:madecassoside",
            "inci:panthenol",
            "inci:titanium-dioxide",
            "inci:zinc-oxide",
            "inci:niacinamide",
        ],
        avoided_ingredient_ids=[
            "inci:fragrance",
            "inci:sodium-lauryl-sulfate",
            "inci:retinol",
        ],
        favorite_brick_codes=[],
        narrative_ko=(
            "환절기마다 볼이 붉어지고 따가운 민감성 피부. 자외선차단제를 사도 결국 트러블이 나서 "
            "'민감성 피부에 좋은 무기자차 선크림'을 매번 검색하는 데 지쳤다. 올리브영을 주로 이용한다."
        ),
        is_wow=True,
    ),
    Persona(
        persona_id="psn_004",
        label_ko="35세 헬스 챌린저",
        age=35,
        gender="M",
        life_stage_ko="기혼·미자녀",
        occupation_ko="외국계 기업 차장",
        concern_ids=["con_15", "con_14", "con_24"],
        preferred_ingredient_ids=[],
        avoided_ingredient_ids=[],
        favorite_brick_codes=["10000228", "10000160", "10001300"],
        narrative_ko=(
            "체지방 감량과 근육 증가를 동시에 잡는 12주 챌린지 중. 단백질 25g 이상·당류 5g 이하 간식을 찾는다. "
            "출근길 GS25에서 단백질 음료와 시리얼바를 매일 구매. 라벨 영양정보를 꼼꼼히 본다."
        ),
        is_wow=True,
    ),
    Persona(
        persona_id="psn_005",
        label_ko="40세 MD (롯데마트 식품MD)",
        age=40,
        gender="F",
        life_stage_ko="기혼·자녀 둘",
        occupation_ko="롯데마트 식품MD 차장",
        concern_ids=[],
        preferred_ingredient_ids=[],
        avoided_ingredient_ids=[],
        favorite_brick_codes=[],
        narrative_ko=(
            "신상 운영기획을 담당하는 식품 MD. '20대 여성 검색 빈도가 급증한 성분 Top10'처럼 "
            "트렌드를 자연어 쿼리로 즉시 확인하고, 그 결과를 카테고리·브랜드·경쟁사 그래프로 드릴다운하는 "
            "도구를 원한다. 시나리오 C의 페르소나."
        ),
        is_wow=True,
    ),
]


# --------------------------------------------------------------------------
# LLM generation for the remaining 35 personas
# --------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "당신은 한국 Retail/CPG 영업 데모용 페르소나를 설계하는 시니어 데이터 디자이너입니다. "
    "각 페르소나는 한국 편의점·마트·올리브영·쿠팡 사용자 분포를 반영하고, "
    "이름이나 PII는 절대 포함하지 않습니다(라벨/직업/관심사만)."
)


def _user_prompt(start_idx: int, count: int, taken_labels: List[str]) -> str:
    return (
        f"persona_id가 psn_{{i:03d}} (i={start_idx}부터 {start_idx + count - 1}까지)인 "
        f"한국 소비자 페르소나 {count}명을 생성하세요.\n\n"
        f"이미 사용된 라벨(중복 회피): {', '.join(taken_labels) if taken_labels else '(없음)'}\n\n"
        "요구사항:\n"
        "- age 18-65 분포, gender 균형 (F:M ≈ 6:4 — 한국 화장품/식품 쇼퍼 비율 반영)\n"
        "- life_stage_ko: '20대 대학생'·'30대 직장인'·'육아중'·'은퇴 준비' 등 자연스러운 한국어 표현\n"
        "- concern_ids: 1~3개를 con_01..con_25 범위에서 선택 (skin/diet/lifestyle 혼합 권장)\n"
        "- favorite_brick_codes: 0~3개. 사용 가능한 GS1 brick 코드 일부:\n"
        "  10000159(탄산음료) 10000245(커피) 10000604(스낵) 10000228(시리얼바) "
        "  10000148(요거트) 10000064(우유) 10000400(생수) 10000247(에너지드링크) "
        "  10000900(편의점도시락) 10000901(삼각김밥) 10001300(비타민) 10001301(유산균)\n"
        "- preferred/avoided_ingredient_ids: 0~3개. inci: 또는 ntr: prefix.\n"
        "- narrative_ko: 2~4문장의 자연스러운 한국어 라이프스타일 묘사 (PII 금지)\n"
        "- is_wow는 항상 false\n"
        "- label_ko는 위에 나열된 라벨과 중복 금지\n"
    )


def generate_remaining(*, total: int = 40, batch_size: int = 10, dry_run: bool = False) -> List[Persona]:
    needed = total - len(WOW_PERSONAS)
    if needed <= 0:
        return []
    if dry_run:
        print(f"[dry-run] would generate {needed} personas in {-(-needed // batch_size)} calls")
        return []

    item_schema = Persona.model_json_schema()
    tool_schema = array_tool_schema(item_schema, min_items=1, max_items=batch_size)
    taken = [p.label_ko for p in WOW_PERSONAS]
    out: List[Persona] = []
    start_idx = len(WOW_PERSONAS) + 1

    while len(out) < needed:
        batch = min(batch_size, needed - len(out))
        prompt = _user_prompt(start_idx + len(out), batch, taken)
        print(f"  → calling Bedrock for personas {start_idx + len(out)}..{start_idx + len(out) + batch - 1}")
        result = call_with_tool(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=prompt,
            tool_name="save_personas",
            tool_description="Save the generated persona batch.",
            input_schema=tool_schema,
            temperature=0.8,
        )
        items = result.get("items", [])
        for raw in items:
            try:
                p = Persona(**raw)
                p.is_wow = False
                out.append(p)
                taken.append(p.label_ko)
                if len(out) >= needed:
                    break
            except ValidationError as e:
                print(f"    ! skip invalid item: {e.errors()[0]['msg']}")
    return out


def write_ndjson(personas: List[Persona]) -> None:
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        for p in personas:
            f.write(p.model_dump_json(exclude_none=True) + "\n")
    print(f"  wrote {len(personas)} personas → {OUTPUT_PATH.relative_to(OUTPUT_PATH.parents[2])}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=40, help="Total personas to produce (default 40)")
    parser.add_argument("--dry-run", action="store_true", help="Skip Bedrock; only show plan")
    parser.add_argument("--wow-only", action="store_true", help="Write only the 5 hardcoded wow personas")
    args = parser.parse_args()

    personas = list(WOW_PERSONAS[: args.limit])
    if not args.wow_only and len(personas) < args.limit:
        personas.extend(generate_remaining(total=args.limit, dry_run=args.dry_run))

    if not args.dry_run:
        write_ndjson(personas)


if __name__ == "__main__":
    main()
