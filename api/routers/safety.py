"""Scenario E — POST /api/safety-check.

Audience-aware safety analysis: user picks a "safety profile" (임산부 / 어린이
/ 글루텐프리 / 비건 / 시카케어 / 캠핑) and we walk the existing Concern graph to
classify every product candidate as SAFE or VIOLATING.

Why this is meaningful even though it shares plumbing with persona-match:
- D (Persona Match) is one-user driven (single persona's narrative)
- E (Safety Lens) is class-driven (any pregnant person, any 4-yr-old) — the
  audience profile maps to a SET of concern_ids, not a specific persona

The profile→concern map is a thin static table; mapping NL → profile is done
client-side via sample-button taps (the demo's "wow query" pattern). The
LLM-driven NL mapper exists as a fallback for free-form queries.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.aws_clients import bedrock_runtime
from api.config import get_settings
from api.services import neptune

router = APIRouter(tags=["safety"])


# Each profile is a bundle: human label + concern_ids that drive
# AVOIDS_INGREDIENT lookup. Keys aligned with web sample buttons.
_DOMAIN_HINTS: Dict[str, List[str]] = {
    # NL keywords → product.domain filter. Matches CASE-INSENSITIVE substring.
    "beauty": ["화장품", "뷰티", "스킨케어", "코스메틱", "스킨", "토너", "세럼",
               "크림", "로션", "에센스", "선크림", "선블록", "마스크팩"],
    "grocery": ["음식", "식품", "간식", "먹는", "먹을", "먹어도", "스낵", "음료",
                "과자", "쿠키", "초콜릿", "라면", "유제품", "우유", "단백질",
                "도시락", "시리얼", "비타민"],
}


def _detect_domain(text: Optional[str]) -> Optional[str]:
    """Pick a `product.domain` filter from the user's NL query. None if
    ambiguous (the safety result then includes both food and beauty)."""
    if not text:
        return None
    t = text.lower()
    hits = {dom: sum(1 for kw in kws if kw in t or kw.lower() in t)
            for dom, kws in _DOMAIN_HINTS.items()}
    # Pick the domain with strictly more hits; tie or zero → no filter.
    ranked = sorted(hits.items(), key=lambda x: -x[1])
    if ranked[0][1] == 0:
        return None
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return None
    return ranked[0][0]


SAFETY_PROFILES: Dict[str, Dict[str, Any]] = {
    "pregnant": {
        "label": "임산부 안전",
        "desc": "임산부가 피해야 할 성분(레티놀/살리실산/카페인 과다 등)을 함유한 제품을 위반으로 표시.",
        "concern_keywords": ["임산부", "임신", "수유"],
    },
    "child_4": {
        "label": "어린이 4세",
        "desc": "유아·아동 대상 알레르겐(글루텐/땅콩/유제품)과 자극 성분을 위반으로 표시.",
        "concern_keywords": ["어린이", "아이", "아동", "글루텐"],
    },
    "gluten_free": {
        "label": "글루텐프리",
        "desc": "글루텐 함유 성분(밀/보리/호밀 등)을 위반으로 표시.",
        "concern_keywords": ["글루텐", "셀리악"],
    },
    "vegan": {
        "label": "비건",
        "desc": "동물성 성분(꿀/우유/계란/콜라겐 등) 함유 제품을 위반으로 표시.",
        "concern_keywords": ["비건", "동물성", "채식"],
    },
    "sensitive_skin": {
        "label": "민감성 피부",
        "desc": "알코올/향료/파라벤 등 자극 성분 함유 제품을 위반으로 표시.",
        "concern_keywords": ["민감성", "민감", "트러블", "시카"],
    },
    "diabetes": {
        "label": "당뇨 관리",
        "desc": "고당류·정제 탄수화물 제품을 위반으로 표시.",
        "concern_keywords": ["당뇨", "혈당", "저당"],
    },
}


class SafetyCheckRequest(BaseModel):
    profile_id: Optional[str] = None
    q: Optional[str] = Field(default=None, max_length=400)
    domain: Optional[str] = None  # 'beauty' | 'grocery' | None (auto-detect from q)
    top_k: int = Field(default=15, ge=1, le=40)


class SafetyProductHit(BaseModel):
    sku_id: str
    name: str
    domain: Optional[str] = None
    score: int
    violations: List[str] = Field(default_factory=list)
    matched_concerns: List[str] = Field(default_factory=list)


class SafetyCheckResponse(BaseModel):
    profile_id: str
    profile_label: str
    profile_desc: str
    domain: Optional[str] = None  # echo of applied filter (None = both)
    matched_concerns: List[Dict[str, Any]]
    safe: List[SafetyProductHit]
    violating: List[SafetyProductHit]
    summary_ko: str
    subgraph: Dict[str, Any]


def _props(n: Any) -> Dict[str, Any]:
    return dict(n.get("~properties", {})) if isinstance(n, dict) else {}


def _node_id(n: Any) -> str:
    return n.get("~id", "") if isinstance(n, dict) else str(n)


def _resolve_profile(req: SafetyCheckRequest) -> Dict[str, Any]:
    """Pick a profile either from explicit profile_id or by NL→profile mapping
    via Sonnet 4.6 on free-form `q`. Falls back to `pregnant` if both empty."""
    if req.profile_id and req.profile_id in SAFETY_PROFILES:
        return {"profile_id": req.profile_id, **SAFETY_PROFILES[req.profile_id]}
    if req.q:
        # Cheap keyword match first (no LLM round-trip if possible).
        ql = req.q.lower()
        for pid, prof in SAFETY_PROFILES.items():
            if any(kw in req.q or kw.lower() in ql for kw in prof["concern_keywords"]):
                return {"profile_id": pid, **prof}
        # NL fallback to Sonnet 4.6.
        try:
            s = get_settings()
            options = "\n".join(f"- {pid}: {p['label']}" for pid, p in SAFETY_PROFILES.items())
            resp = bedrock_runtime().converse(
                modelId=s.bedrock_chat_model_id,
                messages=[{"role": "user", "content": [{
                    "text": f"질문: {req.q}\n\n다음 안전 프로필 중 가장 적절한 ID 하나만 골라주세요. "
                            f"코드만 출력 (예: pregnant). 옵션:\n{options}"
                }]}],
                inferenceConfig={"maxTokens": 30, "temperature": 0.0},
            )
            for block in resp["output"]["message"]["content"]:
                t = (block.get("text") or "").strip().lower()
                for pid in SAFETY_PROFILES:
                    if pid in t:
                        return {"profile_id": pid, **SAFETY_PROFILES[pid]}
        except Exception:  # noqa: BLE001
            pass
    return {"profile_id": "pregnant", **SAFETY_PROFILES["pregnant"]}


@router.get("/safety/profiles")
def list_profiles() -> Dict[str, Any]:
    """Sample buttons for the safety page UI."""
    return {
        "items": [
            {"id": pid, "label": p["label"], "desc": p["desc"]}
            for pid, p in SAFETY_PROFILES.items()
        ],
    }


@router.post("/safety-check", response_model=SafetyCheckResponse)
def safety_check(req: SafetyCheckRequest) -> SafetyCheckResponse:
    profile = _resolve_profile(req)
    # Domain filter: explicit value wins; otherwise auto-detect from q.
    domain = req.domain
    if domain not in ("beauty", "grocery"):
        domain = _detect_domain(req.q)

    # Match concerns whose name_ko contains any of the profile's keywords.
    # Neptune openCypher rejects `any(... IN list)` predicate (per ECQ docs)
    # so we UNWIND the keyword list and DISTINCT the matching concerns.
    keywords = profile.get("concern_keywords") or []
    concerns_q = (
        "UNWIND $kws AS kw "
        "MATCH (c:Concern) WHERE c.name_ko CONTAINS kw "
        "WITH DISTINCT c "
        "OPTIONAL MATCH (c)-[:AVOIDS_INGREDIENT]->(ai:Ingredient) "
        "RETURN c, collect(DISTINCT ai.ingredient_id) AS avoided_ings "
        "LIMIT 20"
    )
    crows = neptune.open_cypher(concerns_q, parameters={"kws": keywords})
    matched_concerns: List[Dict[str, Any]] = []
    avoided_set: set = set()
    concern_ids: List[str] = []
    for r in crows:
        c = _props(r.get("c"))
        if not c:
            continue
        matched_concerns.append(c)
        cid = c.get("concern_id")
        if cid:
            concern_ids.append(cid)
        for iid in (r.get("avoided_ings") or []):
            if iid:
                avoided_set.add(iid)
    avoided_ings = sorted(avoided_set)

    # Score products: count how many of the matched concerns each product
    # targets (positive); count how many avoided ingredients it contains
    # (violations). A product is "safe" iff violation_count == 0.
    # Score products: count how many of the matched concerns each product
    # targets (positive); count how many avoided ingredients it contains
    # (violations). Build prod_ings via OPTIONAL MATCH first, then list-filter
    # against $avoid using `WHERE ... IN prod_ings` (which IS supported).
    # Domain filter (beauty | grocery) is applied at the entry MATCH so we
    # don't waste compute on irrelevant rows.
    domain_clause = " WHERE p.domain = $domain " if domain in ("beauty", "grocery") else " "
    score_q = (
        f"MATCH (p:Product){domain_clause}"
        "OPTIONAL MATCH (p)-[:TARGETS_CONCERN]->(c:Concern) WHERE c.concern_id IN $cids "
        "WITH p, count(DISTINCT c) AS concern_match, "
        "     collect(DISTINCT c.concern_id) AS hit_concerns "
        "OPTIONAL MATCH (p)-[:HAS_INGREDIENT]->(ing:Ingredient) "
        "WITH p, concern_match, hit_concerns, collect(DISTINCT ing.ingredient_id) AS prod_ings "
        "WITH p, concern_match, hit_concerns, "
        "     [x IN $avoid WHERE x IN prod_ings] AS violations "
        "WITH p, concern_match, hit_concerns, violations, size(violations) AS vc "
        "WHERE concern_match > 0 OR vc > 0 "
        "RETURN p, concern_match, hit_concerns, violations, vc "
        "ORDER BY (concern_match - 100 * vc) DESC LIMIT 80"
    )
    score_params: Dict[str, Any] = {"cids": concern_ids, "avoid": avoided_ings}
    if domain in ("beauty", "grocery"):
        score_params["domain"] = domain
    prows = neptune.open_cypher(score_q, parameters=score_params)
    safe: List[SafetyProductHit] = []
    violating: List[SafetyProductHit] = []
    subgraph_nodes: Dict[str, Dict[str, Any]] = {}
    subgraph_edges: List[Dict[str, Any]] = []

    # Concern nodes always in subgraph
    for c in crows:
        cn = c.get("c")
        if not cn:
            continue
        cid_n = _node_id(cn)
        subgraph_nodes[cid_n] = {"data": {"id": cid_n, "label": "Concern", **_props(cn)}}

    for r in prows:
        prod = r.get("p") or {}
        p = _props(prod)
        hit = SafetyProductHit(
            sku_id=str(p.get("sku_id", "")),
            name=str(p.get("name_ko") or p.get("name_en") or "(unnamed)"),
            domain=p.get("domain"),
            score=int((r.get("concern_match") or 0) - 100 * (r.get("vc") or 0)),
            violations=list(r.get("violations") or []),
            matched_concerns=list(r.get("hit_concerns") or []),
        )
        if hit.violations:
            violating.append(hit)
        else:
            safe.append(hit)
        # Add to subgraph (limit density)
        if len(safe) <= req.top_k or hit.violations:
            pid_n = _node_id(prod)
            if pid_n and pid_n not in subgraph_nodes:
                subgraph_nodes[pid_n] = {"data": {"id": pid_n, "label": "Product", **p}}

    safe = safe[: req.top_k]
    violating = violating[: req.top_k]
    domain_label = {"beauty": "화장품 도메인만", "grocery": "식품 도메인만"}.get(domain or "", "전체 도메인")
    summary = (
        f"'{profile['label']}' 프로필 · {domain_label} 기준. "
        f"매칭된 우려사항 {len(matched_concerns)}개, 피해야 할 성분 {len(avoided_ings)}개. "
        f"안전 후보 {len(safe)}개, 위반 후보 {len(violating)}개."
    )

    return SafetyCheckResponse(
        profile_id=profile["profile_id"],
        profile_label=profile["label"],
        profile_desc=profile["desc"],
        domain=domain,
        matched_concerns=matched_concerns,
        safe=safe,
        violating=violating,
        summary_ko=summary,
        subgraph={"nodes": list(subgraph_nodes.values()), "edges": subgraph_edges},
    )
