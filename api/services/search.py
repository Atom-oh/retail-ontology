"""
Hybrid search: OpenSearch BM25 (Nori) + KNN (Cohere embed) → Bedrock Rerank.

Pipeline (spec § 7.1):
  1. Embed query (Cohere)
  2. OpenSearch hybrid query: BM25 on Korean text + KNN on vector field
  3. Bedrock Rerank top-100 → top-k via cross-region inference profile
  4. Guardrails sweep before rerank (PII safety per spec § 10.2)
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, TypedDict

import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from api.aws_clients import bedrock_runtime, session
from api.config import get_settings
from api.services import embedding, guardrails


class SearchHit(TypedDict):
    sku_id: str
    score: float
    text: str
    metadata: Dict[str, Any]


def hybrid_search(
    query: str,
    *,
    top_k: int = 10,
    candidate_pool: int = 100,
    apply_guardrails: bool = True,
    rerank: bool = True,
) -> List[SearchHit]:
    settings = get_settings()
    if apply_guardrails:
        scrubbed = guardrails.apply_or_none(query, source="INPUT") or query
    else:
        scrubbed = query

    qvec = embedding.embed_query(scrubbed)

    body = {
        "size": candidate_pool,
        "query": {
            "hybrid": {
                "queries": [
                    {
                        "match": {
                            "AMAZON_BEDROCK_TEXT_CHUNK": {
                                "query": scrubbed,
                                "analyzer": "korean_nori",
                            }
                        }
                    },
                    {
                        "knn": {
                            "bedrock-knowledge-base-default-vector": {
                                "vector": qvec,
                                "k": candidate_pool,
                            }
                        }
                    },
                ]
            }
        },
        "_source": ["AMAZON_BEDROCK_TEXT_CHUNK", "AMAZON_BEDROCK_METADATA"],
    }
    raw = _signed_post(
        f"{settings.opensearch_endpoint.rstrip('/')}/{settings.opensearch_index}/_search",
        body,
    )
    hits_raw = raw.get("hits", {}).get("hits", [])

    candidates: List[SearchHit] = []
    for h in hits_raw:
        src = h.get("_source", {})
        candidates.append(SearchHit(
            sku_id=h.get("_id", ""),
            score=float(h.get("_score", 0.0)),
            text=src.get("AMAZON_BEDROCK_TEXT_CHUNK", ""),
            metadata=_parse_metadata(src.get("AMAZON_BEDROCK_METADATA", "")),
        ))

    if not rerank or not settings.bedrock_reranker_inference_profile_arn or not candidates:
        return candidates[:top_k]

    return _bedrock_rerank(scrubbed, candidates, top_k)


def _bedrock_rerank(query: str, candidates: List[SearchHit], top_k: int) -> List[SearchHit]:
    settings = get_settings()
    docs = [{"text": c["text"]} for c in candidates]
    body = {"query": query, "documents": docs, "top_n": top_k}
    resp = bedrock_runtime().invoke_model(
        modelId=settings.bedrock_reranker_inference_profile_arn,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )
    payload = json.loads(resp["body"].read())
    out: List[SearchHit] = []
    for r in payload.get("results", []):
        idx = r["index"]
        c = dict(candidates[idx])
        c["score"] = float(r.get("relevance_score", 0.0))
        out.append(c)  # type: ignore[arg-type]
    return out


def _parse_metadata(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"_raw": raw}
    return {}


def _signed_post(url: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """SigV4 POST to OpenSearch Serverless data plane."""
    settings = get_settings()
    creds = session().get_credentials().get_frozen_credentials()
    req = AWSRequest(
        method="POST",
        url=url,
        data=json.dumps(body),
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(creds, "aoss", settings.aws_region).add_auth(req)
    resp = requests.post(
        url,
        headers=dict(req.headers),
        data=req.body,
        timeout=settings.request_timeout_seconds,
    )
    resp.raise_for_status()
    return resp.json()
