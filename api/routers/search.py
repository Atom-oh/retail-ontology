"""Scenario A — POST /api/search."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.services import neptune, search

router = APIRouter(tags=["search"])


class SearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=500, description="자연어 검색어")
    persona: Optional[str] = None
    top_k: int = Field(default=10, ge=1, le=50)
    include_subgraph: bool = True


class SearchHitOut(BaseModel):
    sku_id: str
    score: float
    text: str
    metadata: Dict[str, Any]


class SearchResponse(BaseModel):
    hits: List[SearchHitOut]
    subgraph: Dict[str, Any]
    query_echo: str


@router.post("/search", response_model=SearchResponse)
def search_endpoint(req: SearchRequest) -> SearchResponse:
    hits = search.hybrid_search(req.q, top_k=req.top_k)
    subgraph: Dict[str, Any] = {"nodes": [], "edges": []}
    if req.include_subgraph and hits:
        try:
            subgraph = neptune.subgraph_for_skus([h["sku_id"] for h in hits[:5]])
        except Exception:  # noqa: BLE001
            subgraph = {"nodes": [], "edges": [], "_error": "subgraph_unavailable"}
    return SearchResponse(
        hits=[SearchHitOut(**h) for h in hits],
        subgraph=subgraph,
        query_echo=req.q,
    )
