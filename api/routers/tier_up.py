"""Scenario K — Tier-up Path (등급 상승 경로).

Identifies products and categories that differentiate Gold members from
Silver members ("등급 상승 시그널"), and lists Silver members closest to
the Gold threshold ("업그레이드 후보").

Lift model is counter-factual: we don't have time-series tier transitions
in the synthetic dataset (each member sits at one tier today), so we treat
the *current* Gold cohort as the post-transition state and Silver as the
pre-transition state. Product/category lift = Gold purchase rate ÷ Silver
purchase rate, both normalised by cohort size.

Endpoint:
  GET /api/tier-up/dashboard
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.services import neptune

router = APIRouter(tags=["tier-up"])

# Distance from Gold threshold (2,000,000 KRW per data/synthetic/membership.py)
# at which a Silver member is flagged as a candidate. 25% gap = LTV ≥ 1.5M.
CANDIDATE_LTV_FLOOR = 1_500_000


class ProductLift(BaseModel):
    sku_id: str
    name_ko: str
    domain: Optional[str] = None
    silver_buyers: int
    gold_buyers: int
    lift: float


class CategoryLift(BaseModel):
    gs1_brick_code: str
    name_ko: str
    silver_buyers: int
    gold_buyers: int
    lift: float


class UpgradeCandidate(BaseModel):
    member_id: str
    name_ko: str
    persona_id: Optional[str] = None
    persona_label_ko: Optional[str] = None
    ltv_krw: int
    monetary_krw: int
    frequency: int
    recency_days: int
    gap_to_gold_krw: int
    churn_risk: float


class TierUpSummary(BaseModel):
    silver_count: int
    gold_count: int
    silver_to_gold_ratio: float
    candidates_count: int
    avg_candidate_ltv_krw: int


class TierUpDashboardResponse(BaseModel):
    summary: TierUpSummary
    product_lift: List[ProductLift]
    category_lift: List[CategoryLift]
    upgrade_candidates: List[UpgradeCandidate]


def _props(n: Any) -> Dict[str, Any]:
    return dict(n.get("~properties", {})) if isinstance(n, dict) else {}


@router.get("/tier-up/dashboard", response_model=TierUpDashboardResponse)
def tier_up_dashboard(top_k: int = 25) -> TierUpDashboardResponse:
    top_k = max(1, min(top_k, 100))

    # 1. Cohort sizes — used both for the summary and as denominators in the
    # lift normalization below (so the lift is per-capita, not raw count).
    rows = neptune.open_cypher(
        "MATCH (m:Member) WHERE m.tier IN ['Silver', 'Gold'] "
        "RETURN m.tier AS tier, count(m) AS c"
    )
    sizes = {str(r.get("tier") or ""): int(r.get("c") or 0) for r in rows}
    silver_n = sizes.get("Silver", 0)
    gold_n = sizes.get("Gold", 0)

    # 2. Product lift: Gold buyers per cohort / Silver buyers per cohort.
    rows = neptune.open_cypher(
        "MATCH (m:Member)-[:MADE]->(:Transaction)-[:OF_PRODUCT]->(p:Product) "
        "WHERE m.tier IN ['Silver', 'Gold'] "
        "WITH p, m.tier AS tier, count(DISTINCT m) AS buyers "
        "WITH p, "
        "     sum(CASE WHEN tier='Silver' THEN buyers ELSE 0 END) AS silver_buyers, "
        "     sum(CASE WHEN tier='Gold' THEN buyers ELSE 0 END) AS gold_buyers "
        "WHERE gold_buyers >= 5 "  # filter long-tail noise
        "RETURN p, silver_buyers, gold_buyers"
    )
    products: List[ProductLift] = []
    for r in rows:
        p = _props(r.get("p"))
        s = int(r.get("silver_buyers") or 0)
        g = int(r.get("gold_buyers") or 0)
        # Per-capita: gold_rate / silver_rate. Tiny silver_n ⇒ skip to avoid
        # divide-by-zero pollution.
        if silver_n == 0 or gold_n == 0:
            continue
        gold_rate = g / gold_n
        silver_rate = s / silver_n if s else (1 / silver_n / 2)  # half-step smoothing
        lift = round(gold_rate / silver_rate, 2) if silver_rate else 0.0
        products.append(ProductLift(
            sku_id=str(p.get("sku_id") or ""),
            name_ko=str(p.get("name_ko") or ""),
            domain=p.get("domain"),
            silver_buyers=s,
            gold_buyers=g,
            lift=lift,
        ))
    products.sort(key=lambda x: x.lift, reverse=True)
    product_lift = products[:top_k]

    # 3. Category lift — same shape, but on Category nodes.
    rows = neptune.open_cypher(
        "MATCH (m:Member)-[:MADE]->(:Transaction)-[:OF_PRODUCT]->(p:Product)"
        "-[:IN_CATEGORY]->(c:Category) "
        "WHERE m.tier IN ['Silver', 'Gold'] "
        "WITH c, m.tier AS tier, count(DISTINCT m) AS buyers "
        "WITH c, "
        "     sum(CASE WHEN tier='Silver' THEN buyers ELSE 0 END) AS silver_buyers, "
        "     sum(CASE WHEN tier='Gold' THEN buyers ELSE 0 END) AS gold_buyers "
        "WHERE gold_buyers >= 10 "
        "RETURN c, silver_buyers, gold_buyers"
    )
    categories: List[CategoryLift] = []
    for r in rows:
        c = _props(r.get("c"))
        s = int(r.get("silver_buyers") or 0)
        g = int(r.get("gold_buyers") or 0)
        if silver_n == 0 or gold_n == 0:
            continue
        gold_rate = g / gold_n
        silver_rate = s / silver_n if s else (1 / silver_n / 2)
        lift = round(gold_rate / silver_rate, 2) if silver_rate else 0.0
        categories.append(CategoryLift(
            gs1_brick_code=str(c.get("gs1_brick_code") or ""),
            name_ko=str(c.get("retail_category_ko") or c.get("gs1_brick_name_en") or ""),
            silver_buyers=s,
            gold_buyers=g,
            lift=lift,
        ))
    categories.sort(key=lambda x: x.lift, reverse=True)
    category_lift = categories[:15]

    # 4. Upgrade candidates: Silver tier with LTV ≥ floor; sort by closeness to Gold.
    rows = neptune.open_cypher(
        "MATCH (m:Member {tier: 'Silver'}) "
        "WHERE coalesce(m.ltv_krw, 0) >= $floor "
        "OPTIONAL MATCH (m)-[:MATCHES_PERSONA]->(p:Persona) "
        "RETURN m, p "
        "ORDER BY m.ltv_krw DESC LIMIT 20",
        parameters={"floor": CANDIDATE_LTV_FLOOR},
    )
    candidates: List[UpgradeCandidate] = []
    for r in rows:
        m = _props(r.get("m"))
        p = _props(r.get("p")) if r.get("p") else {}
        ltv = int(m.get("ltv_krw") or 0)
        candidates.append(UpgradeCandidate(
            member_id=str(m.get("member_id") or ""),
            name_ko=str(m.get("name_ko") or ""),
            persona_id=m.get("persona_id"),
            persona_label_ko=p.get("label_ko"),
            ltv_krw=ltv,
            monetary_krw=int(m.get("monetary_krw") or 0),
            frequency=int(m.get("frequency") or 0),
            recency_days=int(m.get("recency_days") or 0),
            gap_to_gold_krw=max(0, 2_000_000 - ltv),
            churn_risk=float(m.get("churn_risk") or 0.0),
        ))

    avg_candidate_ltv = (
        sum(c.ltv_krw for c in candidates) // len(candidates)
        if candidates else 0
    )
    summary = TierUpSummary(
        silver_count=silver_n,
        gold_count=gold_n,
        silver_to_gold_ratio=round(silver_n / gold_n, 2) if gold_n else 0.0,
        candidates_count=len(candidates),
        avg_candidate_ltv_krw=avg_candidate_ltv,
    )

    return TierUpDashboardResponse(
        summary=summary,
        product_lift=product_lift,
        category_lift=category_lift,
        upgrade_candidates=candidates,
    )
