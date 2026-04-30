"""Scenario J — Acquisition Channel ROI (확보 채널 ROI).

For each acquisition campaign and each marketing channel, computes:
  - reach        (touchpoints sent)
  - responded    (touchpoints with responded=true)
  - response_rate
  - attributed members (members with at least one responded touchpoint)
  - attributed LTV (sum of those members' ltv_krw)
  - cost (from Campaign.cost_krw)
  - ROI (attributed LTV / cost)

Also produces a Persona × Channel matrix so the page can show "임산부
페르소나는 카카오톡 푸시가 이메일 대비 N배" — the wow line from the J
scenario spec.

Attribution model is intentionally simple for a PoC: a single responded
touchpoint counts as attribution. Multi-touch attribution would need a
windowing layer that the demo doesn't justify.

Endpoint:
  GET /api/acquisition/dashboard
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.services import neptune

router = APIRouter(tags=["acquisition"])


class CampaignRoi(BaseModel):
    campaign_id: str
    name_ko: str
    channel: str
    target_persona_ids: List[str] = Field(default_factory=list)
    cost_krw: int
    sent: int
    responded: int
    response_rate: float
    attributed_members: int
    attributed_ltv_krw: int
    roi: float


class ChannelRoi(BaseModel):
    channel: str
    sent: int
    responded: int
    response_rate: float
    attributed_members: int
    attributed_ltv_krw: int
    cost_krw: int
    roi: float


class PersonaChannelCell(BaseModel):
    persona_id: str
    persona_label_ko: str
    channel: str
    sent: int
    responded: int
    response_rate: float


class AcquisitionSummary(BaseModel):
    total_campaigns: int
    total_cost_krw: int
    total_attributed_members: int
    total_attributed_ltv_krw: int
    blended_roi: float
    best_channel: Optional[str] = None
    best_channel_roi: float = 0.0


class AcquisitionDashboardResponse(BaseModel):
    summary: AcquisitionSummary
    campaigns: List[CampaignRoi]
    channels: List[ChannelRoi]
    persona_channel_matrix: List[PersonaChannelCell]


def _props(n: Any) -> Dict[str, Any]:
    return dict(n.get("~properties", {})) if isinstance(n, dict) else {}


@router.get("/acquisition/dashboard", response_model=AcquisitionDashboardResponse)
def acquisition_dashboard() -> AcquisitionDashboardResponse:
    # 1. Per-campaign ROI for acquisition campaigns.
    rows = neptune.open_cypher(
        "MATCH (c:Campaign) WHERE c.type = 'acquisition' "
        "OPTIONAL MATCH (c)<-[:FROM_CAMPAIGN]-(tp:Touchpoint) "
        "WITH c, count(tp) AS sent, "
        "     sum(CASE WHEN tp.responded THEN 1 ELSE 0 END) AS responded "
        "OPTIONAL MATCH (c)<-[:FROM_CAMPAIGN]-(tp2:Touchpoint {responded: true})"
        "<-[:HAS_TOUCHPOINT]-(m:Member) "
        "OPTIONAL MATCH (c)-[:TARGETS]->(p:Persona) "
        "WITH c, sent, responded, "
        "     count(DISTINCT m) AS attributed_members, "
        "     sum(DISTINCT coalesce(m.ltv_krw, 0)) AS attributed_ltv, "
        "     collect(DISTINCT p.persona_id) AS targets "
        "RETURN c, sent, responded, attributed_members, attributed_ltv, targets "
        "ORDER BY attributed_ltv DESC"
    )
    campaigns: List[CampaignRoi] = []
    for r in rows:
        c = _props(r.get("c"))
        sent = int(r.get("sent") or 0)
        responded = int(r.get("responded") or 0)
        attributed_ltv = int(r.get("attributed_ltv") or 0)
        cost = int(c.get("cost_krw") or 0)
        # Filter out null markers from collect()
        targets = [t for t in (r.get("targets") or []) if t]
        campaigns.append(CampaignRoi(
            campaign_id=str(c.get("campaign_id") or ""),
            name_ko=str(c.get("name_ko") or ""),
            channel=str(c.get("channel") or ""),
            target_persona_ids=targets,
            cost_krw=cost,
            sent=sent,
            responded=responded,
            response_rate=round(responded / sent, 4) if sent else 0.0,
            attributed_members=int(r.get("attributed_members") or 0),
            attributed_ltv_krw=attributed_ltv,
            roi=round(attributed_ltv / cost, 2) if cost else 0.0,
        ))

    # 2. Per-channel rollup across acquisition campaigns.
    rows = neptune.open_cypher(
        "MATCH (c:Campaign) WHERE c.type = 'acquisition' "
        "OPTIONAL MATCH (c)<-[:FROM_CAMPAIGN]-(tp:Touchpoint) "
        "WITH c.channel AS channel, c, "
        "     count(tp) AS sent, "
        "     sum(CASE WHEN tp.responded THEN 1 ELSE 0 END) AS responded "
        "OPTIONAL MATCH (c)<-[:FROM_CAMPAIGN]-(tp2:Touchpoint {responded: true})"
        "<-[:HAS_TOUCHPOINT]-(m:Member) "
        "WITH channel, sum(sent) AS total_sent, sum(responded) AS total_resp, "
        "     sum(coalesce(c.cost_krw, 0)) AS total_cost, "
        "     count(DISTINCT m) AS members, "
        "     sum(DISTINCT coalesce(m.ltv_krw, 0)) AS ltv "
        "RETURN channel, total_sent, total_resp, total_cost, members, ltv "
        "ORDER BY ltv DESC"
    )
    channels: List[ChannelRoi] = []
    for r in rows:
        ch = str(r.get("channel") or "")
        if not ch:
            continue
        sent = int(r.get("total_sent") or 0)
        resp = int(r.get("total_resp") or 0)
        cost = int(r.get("total_cost") or 0)
        ltv = int(r.get("ltv") or 0)
        channels.append(ChannelRoi(
            channel=ch,
            sent=sent,
            responded=resp,
            response_rate=round(resp / sent, 4) if sent else 0.0,
            attributed_members=int(r.get("members") or 0),
            attributed_ltv_krw=ltv,
            cost_krw=cost,
            roi=round(ltv / cost, 2) if cost else 0.0,
        ))

    # 3. Persona × Channel matrix — touchpoints across ALL campaigns
    # (acquisition + retention + winback) so the matrix reflects each
    # persona's channel responsiveness. The page renders this as a
    # heatmap, scaled per persona row.
    rows = neptune.open_cypher(
        "MATCH (m:Member)-[:HAS_TOUCHPOINT]->(tp:Touchpoint) "
        "MATCH (m)-[:MATCHES_PERSONA]->(p:Persona) "
        "WITH p, tp.type AS channel, count(tp) AS sent, "
        "     sum(CASE WHEN tp.responded THEN 1 ELSE 0 END) AS responded "
        "RETURN p.persona_id AS pid, p.label_ko AS label, channel, sent, responded "
        "ORDER BY p.persona_id, channel"
    )
    matrix: List[PersonaChannelCell] = []
    for r in rows:
        sent = int(r.get("sent") or 0)
        resp = int(r.get("responded") or 0)
        matrix.append(PersonaChannelCell(
            persona_id=str(r.get("pid") or ""),
            persona_label_ko=str(r.get("label") or ""),
            channel=str(r.get("channel") or ""),
            sent=sent,
            responded=resp,
            response_rate=round(resp / sent, 4) if sent else 0.0,
        ))

    # 4. Summary derived from the per-channel + per-campaign tables.
    total_cost = sum(c.cost_krw for c in campaigns)
    total_attributed = sum(c.attributed_members for c in campaigns)
    total_attributed_ltv = sum(c.attributed_ltv_krw for c in campaigns)
    blended_roi = round(total_attributed_ltv / total_cost, 2) if total_cost else 0.0
    best_ch = max(channels, key=lambda x: x.roi, default=None)
    summary = AcquisitionSummary(
        total_campaigns=len(campaigns),
        total_cost_krw=total_cost,
        total_attributed_members=total_attributed,
        total_attributed_ltv_krw=total_attributed_ltv,
        blended_roi=blended_roi,
        best_channel=best_ch.channel if best_ch else None,
        best_channel_roi=best_ch.roi if best_ch else 0.0,
    )

    return AcquisitionDashboardResponse(
        summary=summary,
        campaigns=campaigns,
        channels=channels,
        persona_channel_matrix=matrix,
    )
