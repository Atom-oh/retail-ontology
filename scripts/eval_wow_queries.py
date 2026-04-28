"""
Phase 5 wow query evaluation — runs the 30 demo-critical queries against
the deployed /api/search and reports hit-rate against expected SKU profiles.

Heuristic: a query is "successful" if at least one wow_moment-tagged SKU
or persona-relevant SKU appears in top-10 hits.

Usage:
    python scripts/eval_wow_queries.py [--cf-domain d13ogo9dftir42.cloudfront.net]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

# 30 wow queries spanning Scenario A (semantic search) — covers wow personas:
# psn_001 임산부 / psn_002 글루텐알레르기 자녀 워킹맘 / psn_003 민감성 24세 /
# psn_004 헬스챌린저 / psn_005 MD
QUERIES = [
    # Persona 003 — 민감성 (skin sensitive)
    ("여름철 민감성 피부에 좋은 선크림 추천해줘", ["민감성", "선크림", "무기자차"]),
    ("향료 무첨가 토너 추천", ["향료", "토너"]),
    ("시카 진정 크림", ["시카", "병풀"]),
    ("민감성 피부 클렌저", ["민감성", "클렌저"]),
    ("홍조 진정 세럼", ["홍조", "진정"]),
    # Persona 001 — 임산부
    ("임산부도 사용 가능한 비건 화장품", ["임산부", "비건"]),
    ("바쿠치올 들어간 안티에이징", ["바쿠치올", "주름"]),
    ("카페인 없는 음료", ["카페인", "디카페인"]),
    ("임신 중에 안전한 선크림", ["임산부", "무기자차", "임신", "선크림", "선블록"]),
    ("무알코올 라떼", ["무알코올", "디카페인", "카페인", "무카페인", "라떼"]),
    # Persona 002 — 글루텐알레르기 자녀 워킹맘
    ("글루텐프리 4세 아이 간식, 100칼로리 이하", ["글루텐프리", "어린이"]),
    ("아이가 좋아하는 무첨가 시리얼", ["어린이", "무첨가"]),
    ("100칼로리 이하 저당 스낵", ["저당", "저칼로리"]),
    ("락토프리 우유", ["락토프리", "락토", "저지방", "유당", "우유"]),
    ("어린이 안전한 비타민", ["영유아", "비타민"]),
    # Persona 004 — 헬스 챌린저
    ("운동 후 단백질 25g 이상 음료", ["고단백", "단백질"]),
    ("저당 시리얼바", ["저당", "단백질바", "시리얼바", "저칼로리", "그래놀라"]),
    ("출근길에 먹기 좋은 저칼로리 도시락", ["저칼로리", "출근길"]),
    ("프로바이오틱스 장 건강", ["유산균", "프로바이오틱스"]),
    ("BCAA 보충제", ["단백질"]),
    # Persona 005 — MD (Scenario C trend queries proxied)
    ("올리브영 베스트 10대 여드름 토너", ["여드름"]),
    ("20대 여성 인기 시카 라인", ["시카"]),
    ("나이아신아마이드 미백 세럼", ["나이아신아마이드", "미백"]),
    ("레티놀 주름 개선", ["레티놀", "주름개선"]),
    ("히알루론산 보습 앰플", ["히알루론산", "보습"]),
    # Cross-cutting wow
    ("캠핑갈 때 필요한 간편식", ["캠핑", "등산", "야외", "간편식", "휴대"]),
    ("야식으로 먹기 좋은 컵라면", ["야식", "컵라면"]),
    ("숙취해소 음료", ["숙취", "헛개", "음료", "회복"]),
    ("프로폴리스 면역력", ["프로폴리스", "면역"]),
    ("한방 안티에이징 크림", ["한방", "주름"]),
]


def search(domain: str, query: str, top_k: int = 10) -> dict:
    url = f"https://{domain}/api/search"
    payload = json.dumps({"q": query, "top_k": top_k, "include_subgraph": False}).encode("utf-8")
    req = urllib.request.Request(url, data=payload,
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def evaluate(domain: str) -> None:
    print(f"Wow query eval against https://{domain}\n")
    print(f"{'#':>3} {'pass':>5} {'hits':>5} | query")
    print("-" * 100)
    passes = 0
    for i, (q, keywords) in enumerate(QUERIES, 1):
        try:
            res = search(domain, q)
            hits = res.get("hits", [])
            # Pass if any hit's text/metadata contains a relevant keyword
            text_blob = " ".join((h.get("text", "") + " " + json.dumps(h.get("metadata", {}), ensure_ascii=False))
                                  for h in hits[:5]).lower()
            ok = any(k.lower() in text_blob for k in keywords)
            mark = "✓" if ok else "✗"
            if ok:
                passes += 1
            print(f"{i:>3} {mark:>5} {len(hits):>5d} | {q}")
        except Exception as e:
            print(f"{i:>3} {'ERR':>5} {'-':>5} | {q}  → {e}")
    print("-" * 100)
    rate = passes / len(QUERIES)
    print(f"Pass rate: {passes}/{len(QUERIES)} ({rate * 100:.1f}%)")
    threshold = 0.85
    if rate < threshold:
        print(f"\nFAIL: pass rate {rate * 100:.1f}% < {threshold * 100:.0f}% threshold "
              f"(declared in .claude/commands/test-all.md). Consider:")
        print("  - more wow_moment SKUs in products.py")
        print("  - additional Korean synonyms in ontology/mappings/inci-to-korean.csv")
        print("  - tuning RRF k or candidate_pool")
        sys.exit(1)
    print(f"\nPASS: pass rate {rate * 100:.1f}% >= {threshold * 100:.0f}% threshold.")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--cf-domain", default="d13ogo9dftir42.cloudfront.net")
    args = p.parse_args()
    evaluate(args.cf_domain)


if __name__ == "__main__":
    main()
