"""Scenario G — 가격·가용성 비교 (Price/Availability Compare).

Natural-language query → top SKU candidate(s) → per-channel price/stock
matrix. Prices are *synthesized* deterministically (hash-based) since the
demo has no live POS feed; the wow comes from showing how one SKU varies
across CU / eMart / Olive Young / Kurly with persona-aware "best for you"
recommendation.

Pipeline:
  1. Resolve query → top 3 SKUs via existing semantic_search service.
  2. For each candidate, fetch its actual `AVAILABLE_IN` Channel set from
     Neptune. Channels NOT in the set are marked stock=out.
  3. Synthesize price/discount per (sku, channel) deterministically by
     SHA1 of (sku_id, channel_id). Channel-format multipliers reflect
     real-world Korean retail patterns (CU premium, eMart discount, …).
  4. Apply persona weighting: each persona has a preferred channel-format
     bias (e.g. 임산부 favors eMart for fresh; 1인가구 favors CU). Score
     channels by (price_advantage × persona_match_bonus).
  5. Return ranked recommendation per SKU + side-by-side matrix.
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.services import neptune, search as search_svc

router = APIRouter(tags=["price"])


# Channel-format pricing multipliers vs. base reference price. Reflects
# real Korean retail dynamics — CU is convenience-premium, eMart heavy
# discount, Olive Young is the beauty list price, Kurly is premium e-com.
_CHANNEL_MULT: Dict[str, float] = {
    "chn_cu":         1.12,
    "chn_emart":      0.92,
    "chn_oliveyoung": 1.00,
    "chn_kurly":      1.06,
}

_CHANNEL_LABEL: Dict[str, str] = {
    "chn_cu":         "CU 편의점",
    "chn_emart":      "이마트",
    "chn_oliveyoung": "올리브영",
    "chn_kurly":      "마켓컬리",
}

# Persona format-affinity heuristic — domain × channel_format → bonus 0~1.
# Roughly: 임산부/이유식 prefers 마트; 1인가구 prefers 편의점; 미식·프리미엄
# prefers 컬리; 뷰티 페르소나는 올영. Used to nudge "best channel" pick.
_PERSONA_CHANNEL_BIAS: Dict[str, Dict[str, float]] = {
    # heuristic by free-text label match (Korean substring)
    "임산부":     {"chn_emart": 0.30, "chn_kurly": 0.20, "chn_oliveyoung": 0.05},
    "이유식":     {"chn_emart": 0.30, "chn_kurly": 0.15},
    "1인가구":    {"chn_cu": 0.25, "chn_emart": 0.10},
    "캠핑":       {"chn_cu": 0.20, "chn_emart": 0.15},
    "야간":       {"chn_cu": 0.30},
    "프리미엄":   {"chn_kurly": 0.30, "chn_oliveyoung": 0.10},
    "비건":       {"chn_oliveyoung": 0.20, "chn_kurly": 0.20},
    "글루텐":     {"chn_emart": 0.20, "chn_kurly": 0.20},
    "민감성":     {"chn_oliveyoung": 0.30, "chn_kurly": 0.10},
    "여드름":     {"chn_oliveyoung": 0.30},
    "안티에이징": {"chn_oliveyoung": 0.25, "chn_kurly": 0.10},
    "다이어트":   {"chn_kurly": 0.20, "chn_emart": 0.10},
}


class ChannelPrice(BaseModel):
    channel_id: str
    channel_name_ko: str
    available: bool                  # has AVAILABLE_IN edge
    in_stock: bool                   # synthesized — "currently in stock"
    list_price_krw: int              # before discount
    discount_pct: int                # 0-30
    final_price_krw: int             # after discount
    persona_bonus: float = 0.0       # 0..1 (only set when persona supplied)
    score: float = 0.0               # composite — higher = better-for-user


class PriceCandidate(BaseModel):
    sku_id: str
    name: str
    domain: Optional[str] = None
    brand_id: Optional[str] = None
    base_price_krw: int
    channels: List[ChannelPrice]
    best_channel_id: Optional[str] = None
    best_channel_reason: Optional[str] = None


class PriceCompareRequest(BaseModel):
    q: str
    persona: Optional[str] = None
    top_k: int = Field(default=3, ge=1, le=10)


class PriceCompareResponse(BaseModel):
    query_echo: str
    persona: Optional[str] = None
    persona_label: Optional[str] = None
    candidates: List[PriceCandidate]


def _stable_int(*parts: str, mod: int) -> int:
    """SHA1-based deterministic integer in [0, mod)."""
    h = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return int(h[:8], 16) % max(1, mod)


def _persona_bias(channel_id: str, persona_label: str) -> float:
    if not persona_label:
        return 0.0
    bias = 0.0
    for keyword, weights in _PERSONA_CHANNEL_BIAS.items():
        if keyword in persona_label:
            bias += weights.get(channel_id, 0.0)
    return min(1.0, bias)


def _resolve_persona_label(persona_id: Optional[str]) -> Optional[str]:
    if not persona_id:
        return None
    rows = neptune.open_cypher(
        "MATCH (p:Persona {persona_id: $pid}) RETURN p.label_ko AS label",
        parameters={"pid": persona_id},
    )
    if rows:
        return str(rows[0].get("label") or "")
    return None


def _channel_set_for_sku(sku_id: str) -> set[str]:
    rows = neptune.open_cypher(
        "MATCH (p:Product {sku_id: $sid})-[:AVAILABLE_IN]->(c:Channel) "
        "RETURN c.channel_id AS cid",
        parameters={"sid": sku_id},
    )
    return {str(r.get("cid")) for r in rows if r.get("cid")}


def _synthesize_prices(
    *, sku_id: str, base_price_krw: int, channels_available: set[str], persona_label: Optional[str],
) -> List[ChannelPrice]:
    out: List[ChannelPrice] = []
    for cid, mult in _CHANNEL_MULT.items():
        list_price = int(base_price_krw * mult / 100) * 100  # round to nearest 100 KRW
        # Discount: 0..30% deterministic per (sku, channel). Out-of-stock channels
        # have list price too, but the UI greys them out.
        discount = _stable_int(sku_id, cid, "disc", mod=31)
        final_price = int(list_price * (100 - discount) / 100 / 100) * 100
        in_stock = cid in channels_available and _stable_int(sku_id, cid, "stock", mod=10) > 1
        bonus = _persona_bias(cid, persona_label or "")
        # Composite score — only meaningful for in-stock channels. Lower
        # final_price → higher base; persona bonus added; out-of-stock = 0.
        if not in_stock:
            score = 0.0
        else:
            # Normalize price advantage to 0..1 across channels using base_price
            advantage = max(0.0, 1.0 - (final_price / max(base_price_krw, 1)))
            score = round(advantage * 0.7 + bonus * 0.3, 4)
        out.append(ChannelPrice(
            channel_id=cid, channel_name_ko=_CHANNEL_LABEL[cid],
            available=cid in channels_available, in_stock=in_stock,
            list_price_krw=list_price, discount_pct=discount, final_price_krw=final_price,
            persona_bonus=round(bonus, 3), score=score,
        ))
    return out


def _best_channel(channels: List[ChannelPrice], persona_label: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    in_stock = [c for c in channels if c.in_stock]
    if not in_stock:
        return None, "현재 모든 채널 재고 없음"
    in_stock.sort(key=lambda c: c.score, reverse=True)
    top = in_stock[0]
    parts: List[str] = []
    cheaper_count = sum(1 for c in in_stock if c.final_price_krw > top.final_price_krw)
    if cheaper_count:
        parts.append(f"가격 최저가 ({cheaper_count}개 채널보다 저렴)")
    if persona_label and top.persona_bonus > 0:
        parts.append(f"{persona_label} 페르소나 선호 채널")
    if top.discount_pct >= 15:
        parts.append(f"{top.discount_pct}% 할인 중")
    if not parts:
        parts.append("재고 있음")
    return top.channel_id, " · ".join(parts)


@router.post("/price/compare", response_model=PriceCompareResponse)
def compare_prices(req: PriceCompareRequest) -> PriceCompareResponse:
    persona_label = _resolve_persona_label(req.persona)

    # Top-K SKU candidates via the same hybrid semantic search the search
    # scenario uses — keeps results consistent across pages. `hybrid_search`
    # ignores `persona` (it's a hint, not a filter), so persona only shapes
    # the channel ranking below, not which SKUs are pulled.
    hits = search_svc.hybrid_search(req.q, top_k=req.top_k)
    candidates: List[PriceCandidate] = []
    for h in hits:
        sku_id = h.get("sku_id") or ""
        if not sku_id:
            continue
        # Fetch base props + brand/domain for context.
        rows = neptune.open_cypher(
            "MATCH (p:Product {sku_id: $sid}) "
            "OPTIONAL MATCH (p)-[:BY_BRAND]->(b:Brand) "
            "RETURN p.name_ko AS name, p.domain AS domain, "
            "       p.price_krw AS price, b.brand_id AS brand_id",
            parameters={"sid": sku_id},
        )
        row = rows[0] if rows else {}
        name = str(row.get("name") or h.get("text", sku_id))
        domain = row.get("domain")
        # If real price is in graph use it; otherwise synthesize a base.
        # Demo data exposes price for ~half SKUs; deterministic fallback.
        raw_price = row.get("price")
        try:
            base_price = int(raw_price) if raw_price else 0
        except (TypeError, ValueError):
            base_price = 0
        if base_price <= 0:
            base_price = 5000 + _stable_int(sku_id, "base", mod=30000)
        channels_avail = _channel_set_for_sku(sku_id)
        ch_prices = _synthesize_prices(
            sku_id=sku_id, base_price_krw=base_price,
            channels_available=channels_avail, persona_label=persona_label,
        )
        best_id, best_reason = _best_channel(ch_prices, persona_label)
        candidates.append(PriceCandidate(
            sku_id=sku_id, name=name, domain=domain, brand_id=row.get("brand_id"),
            base_price_krw=base_price, channels=ch_prices,
            best_channel_id=best_id, best_channel_reason=best_reason,
        ))

    return PriceCompareResponse(
        query_echo=req.q, persona=req.persona, persona_label=persona_label,
        candidates=candidates,
    )
