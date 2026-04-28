"""Health endpoint integration tests.

The simplest end-to-end exercise of FastAPI app construction + middleware +
routing, with no AWS dependencies. If this passes, the app is wired correctly.
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_healthz_returns_ok(client) -> None:
    """`/healthz` is the ALB target group health check; must always return 200."""
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_unknown_route_returns_404(client) -> None:
    resp = await client.get("/nope/this/does/not/exist")
    assert resp.status_code == 404
