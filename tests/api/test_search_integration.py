"""Search endpoint integration tests.

Validates request payload contracts (422 on invalid input) and response shape
when downstream services (`api.services.search`, `api.services.neptune`) are
mocked. No AWS calls are made.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.mark.asyncio
async def test_search_rejects_missing_q(client) -> None:
    resp = await client.post("/api/search", json={"top_k": 5})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_rejects_top_k_out_of_range(client) -> None:
    resp = await client.post("/api/search", json={"q": "test", "top_k": 100})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_rejects_oversized_q(client) -> None:
    resp = await client.post("/api/search", json={"q": "x" * 501})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_returns_hits_with_mocked_services(client) -> None:
    """With hybrid_search + subgraph_for_skus mocked, /api/search returns the
    SearchResponse shape (hits list, subgraph dict, query_echo)."""
    fake_hits = [
        {
            "sku_id": "sku_001",
            "score": 0.95,
            "text": "민감성 피부용 무기자차 선크림",
            "metadata": {"brand": "아벤느"},
        },
    ]
    fake_subgraph = {"nodes": [{"id": "sku_001"}], "edges": []}

    with (
        patch("api.routers.search.search.hybrid_search", return_value=fake_hits),
        patch("api.routers.search.neptune.subgraph_for_skus", return_value=fake_subgraph),
    ):
        resp = await client.post(
            "/api/search",
            json={"q": "민감성 피부 선크림", "top_k": 3, "include_subgraph": True},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["query_echo"] == "민감성 피부 선크림"
    assert len(body["hits"]) == 1
    assert body["hits"][0]["sku_id"] == "sku_001"
    assert body["subgraph"] == fake_subgraph


@pytest.mark.asyncio
async def test_search_subgraph_failure_is_isolated(client) -> None:
    """If neptune.subgraph_for_skus raises, the endpoint still returns hits with
    a graceful subgraph error marker — search must not fail because the graph
    fetch did."""
    fake_hits = [{"sku_id": "sku_001", "score": 0.5, "text": "x", "metadata": {}}]

    with (
        patch("api.routers.search.search.hybrid_search", return_value=fake_hits),
        patch(
            "api.routers.search.neptune.subgraph_for_skus",
            side_effect=RuntimeError("neptune unavailable"),
        ),
    ):
        resp = await client.post(
            "/api/search",
            json={"q": "test", "top_k": 1, "include_subgraph": True},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["subgraph"].get("_error") == "subgraph_unavailable"
    assert len(body["hits"]) == 1
