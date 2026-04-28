"""Shared fixtures for tests/api/.

`client` — async httpx client wired directly to the FastAPI ASGI app
(no network, no uvicorn process). DEMO_PUBLIC_MODE is set by tests/conftest.py
so the auth middleware passes through.
"""
from __future__ import annotations

from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """ASGI-direct httpx client. No port binding, no real network."""
    from api.main import app  # local import — env defaults must land first

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
