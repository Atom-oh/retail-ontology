"""Pydantic model validation tests for inline router request/response shapes.

These tests catch schema regressions that would otherwise only surface as 422 errors
in production (e.g., field renames, type changes, missing min/max constraints).
No FastAPI app, no AWS — pure unit tests.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_search_request_requires_q() -> None:
    from api.routers.search import SearchRequest

    with pytest.raises(ValidationError) as exc:
        SearchRequest()  # type: ignore[call-arg]
    assert "q" in str(exc.value)


def test_search_request_validates_top_k_bounds() -> None:
    from api.routers.search import SearchRequest

    # top_k accepts 1..50
    SearchRequest(q="민감성 피부 선크림", top_k=1)
    SearchRequest(q="민감성 피부 선크림", top_k=50)

    with pytest.raises(ValidationError):
        SearchRequest(q="x", top_k=0)
    with pytest.raises(ValidationError):
        SearchRequest(q="x", top_k=51)


def test_search_request_validates_q_length() -> None:
    from api.routers.search import SearchRequest

    with pytest.raises(ValidationError):
        SearchRequest(q="")  # min_length=1
    with pytest.raises(ValidationError):
        SearchRequest(q="a" * 501)  # max_length=500


def test_search_request_defaults() -> None:
    from api.routers.search import SearchRequest

    req = SearchRequest(q="test")
    assert req.top_k == 10
    assert req.include_subgraph is True
    assert req.persona is None


def test_search_response_shape() -> None:
    from api.routers.search import SearchHitOut, SearchResponse

    hit = SearchHitOut(
        sku_id="sku_001",
        score=0.95,
        text="민감성 피부 선크림",
        metadata={"brand": "아벤느"},
    )
    resp = SearchResponse(hits=[hit], subgraph={"nodes": [], "edges": []}, query_echo="민감성")
    assert len(resp.hits) == 1
    assert resp.hits[0].sku_id == "sku_001"
    assert resp.query_echo == "민감성"
