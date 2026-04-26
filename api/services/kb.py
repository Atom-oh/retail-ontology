"""
Bedrock Knowledge Base wrapper.

Used by Scenario B agent tool calls (kb.retrieve) and as a fallback path
for Scenario A when the structured search misses (long-tail queries).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict

from api.aws_clients import bedrock_agent_runtime
from api.config import get_settings


class KBHit(TypedDict):
    text: str
    score: float
    location: Dict[str, Any]
    metadata: Dict[str, Any]


def lookup(query: str, *, top_k: int = 5) -> List[KBHit]:
    s = get_settings()
    resp = bedrock_agent_runtime().retrieve(
        knowledgeBaseId=s.bedrock_kb_id,
        retrievalQuery={"text": query},
        retrievalConfiguration={
            "vectorSearchConfiguration": {
                "numberOfResults": top_k,
                "overrideSearchType": "HYBRID",
            }
        },
    )
    out: List[KBHit] = []
    for r in resp.get("retrievalResults", []):
        out.append(KBHit(
            text=r.get("content", {}).get("text", ""),
            score=float(r.get("score", 0.0)),
            location=r.get("location", {}),
            metadata=r.get("metadata", {}),
        ))
    return out


def rag_answer(query: str, *, session_id: Optional[str] = None, top_k: int = 5) -> Dict[str, Any]:
    """RetrieveAndGenerate — KB retrieval + Bedrock generation in one call."""
    s = get_settings()
    args: Dict[str, Any] = {
        "input": {"text": query},
        "retrieveAndGenerateConfiguration": {
            "type": "KNOWLEDGE_BASE",
            "knowledgeBaseConfiguration": {
                "knowledgeBaseId": s.bedrock_kb_id,
                "modelArn": (
                    f"arn:aws:bedrock:{s.aws_region}::foundation-model/"
                    f"{s.bedrock_chat_model_id_lite}"
                ),
                "retrievalConfiguration": {
                    "vectorSearchConfiguration": {"numberOfResults": top_k},
                },
                "generationConfiguration": {
                    "guardrailConfiguration": {
                        "guardrailId": s.bedrock_guardrail_id,
                        "guardrailVersion": s.bedrock_guardrail_version,
                    },
                },
            },
        },
    }
    if session_id:
        args["sessionId"] = session_id
    return bedrock_agent_runtime().retrieve_and_generate(**args)
