"""
FastAPI entry. Mounts routers, configures CORS, exposes /healthz for ALB
target group health checks (compute-stack tg-api).
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.config import get_settings
from api.routers import chat, health, ingest, insights, search

logger = logging.getLogger("ontology.api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    settings = get_settings()
    logger.info(
        "startup ok region=%s kb=%s guardrail=%s memory=%s opensearch_index=%s",
        settings.aws_region, settings.bedrock_kb_id, settings.bedrock_guardrail_id,
        settings.agentcore_memory_id, settings.opensearch_index,
    )
    yield
    logger.info("shutdown")


app = FastAPI(
    title="Ontology Retail API",
    version="0.1.0",
    description="FastAPI backend — search / chat / insights / ingest",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(search.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(insights.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")


@app.middleware("http")
async def access_log(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "%s %s -> %s %dms",
        request.method, request.url.path, response.status_code, duration_ms,
    )
    return response


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    logger.exception("unhandled exception", exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "internal", "type": type(exc).__name__})
