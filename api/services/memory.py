"""
AgentCore Memory wrapper — short-term (session) + long-term (7-day, user-keyed).

Spec § 4.2: Scenario B's wow moment is "지난 대화에서 임산부라 알려주셨네요" —
the agent retrieves persona-relevant facts from long-term memory.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from api.aws_clients import bedrock_agentcore
from api.config import get_settings


def list_events(session_id: str, *, top_k: int = 10) -> List[Dict[str, Any]]:
    """Recent events from session memory (short-term)."""
    s = get_settings()
    resp = bedrock_agentcore().list_events(
        memoryId=s.agentcore_memory_id,
        sessionId=session_id,
        maxResults=top_k,
    )
    return resp.get("events", [])


def save_event(session_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Append an event to the session (e.g., user msg, agent reply, tool call)."""
    s = get_settings()
    return bedrock_agentcore().create_event(
        memoryId=s.agentcore_memory_id,
        sessionId=session_id,
        payload=payload,
    )


def retrieve_long_term(
    actor_id: str, query: str, *, namespace: Optional[str] = None, top_k: int = 5,
) -> List[Dict[str, Any]]:
    """Long-term memory recall (7-day TTL, user-keyed)."""
    s = get_settings()
    ns = namespace or f"user/{actor_id}/preferences"
    resp = bedrock_agentcore().retrieve_memory_records(
        memoryId=s.agentcore_memory_id,
        namespace=ns,
        searchCriteria={"searchQuery": query, "topK": top_k},
    )
    return resp.get("memoryRecordSummaries", [])
