"""
Cohere Embed Multilingual v3 via Bedrock InvokeModel.

Single-text embedding for query path; batch for ingest path.
Returns 1024-dim float lists ready for OpenSearch knn_vector.
"""
from __future__ import annotations

import json
from typing import List

from api.aws_clients import bedrock_runtime
from api.config import get_settings


def embed_query(text: str) -> List[float]:
    """Embed a single query (input_type='search_query')."""
    return _embed([text], input_type="search_query")[0]


def embed_documents(texts: List[str]) -> List[List[float]]:
    """Embed documents for ingestion (input_type='search_document')."""
    return _embed(texts, input_type="search_document")


def _embed(texts: List[str], *, input_type: str) -> List[List[float]]:
    settings = get_settings()
    body = {
        "texts": texts,
        "input_type": input_type,
        "embedding_types": ["float"],
        "truncate": "END",
    }
    resp = bedrock_runtime().invoke_model(
        modelId=settings.bedrock_embed_model_id,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )
    payload = json.loads(resp["body"].read())
    return payload["embeddings"]["float"]
