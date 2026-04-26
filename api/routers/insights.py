"""
Scenario C — POST /api/insights.

Uses Code Interpreter for chart generation. Falls back to a deterministic
aggregation (Aurora search log → pandas-like rollup) when Code Interpreter
is unavailable.

For demo Phase 3 scaffold, this is a thin wrapper that returns a synthetic
aggregation; the full Code Interpreter integration is wired in Phase 4.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.services import neptune

router = APIRouter(tags=["insights"])


class InsightsRequest(BaseModel):
    q: str = Field(min_length=1, max_length=500)
    period_days: int = Field(default=28, ge=1, le=180)


class InsightsResponse(BaseModel):
    answer_ko: str
    chart_spec: Dict[str, Any]
    drill_down_subgraph: Dict[str, Any]


@router.post("/insights", response_model=InsightsResponse)
def insights_endpoint(req: InsightsRequest) -> InsightsResponse:
    # TODO Phase 4: AgentCore Code Interpreter for real pandas+matplotlib
    # For scaffold, return shape-correct placeholder with top trending ingredients
    # from Neptune's Trend nodes (data path validates end-to-end).
    cypher = """
        MATCH (t:Trend)-[:INVOLVES]->(i:Ingredient)
        WHERE t.type IN ['kbeauty', 'diet']
        RETURN t.name_ko AS trend, collect(i.name_ko)[0..5] AS ingredients
        LIMIT 10
    """
    try:
        rows: List[Dict[str, Any]] = neptune.open_cypher(cypher)
    except Exception:  # noqa: BLE001
        rows = []
    chart_spec = {
        "type": "bar",
        "title": f"{req.q} — 지난 {req.period_days}일 트렌드",
        "data": [{"label": r.get("trend", ""), "value": len(r.get("ingredients", []))}
                 for r in rows],
    }
    return InsightsResponse(
        answer_ko=f"'{req.q}'에 대한 트렌드 분석 (placeholder; Phase 4에서 Code Interpreter 활성화).",
        chart_spec=chart_spec,
        drill_down_subgraph={"nodes": [], "edges": []},
    )
