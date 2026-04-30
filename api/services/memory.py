"""
AgentCore Memory wrapper — short-term (session) + long-term (7-day, user-keyed).

Spec § 4.2: Scenario B's wow moment is "지난 대화에서 임산부라 알려주셨네요" —
the agent retrieves persona-relevant facts from long-term memory.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from api.aws_clients import bedrock_agentcore
from api.config import get_settings

logger = logging.getLogger(__name__)


def list_events(session_id: str, *, top_k: int = 10) -> List[Dict[str, Any]]:
    """Recent events from session memory (short-term)."""
    s = get_settings()
    resp = bedrock_agentcore().list_events(
        memoryId=s.agentcore_memory_id,
        sessionId=session_id,
        maxResults=top_k,
    )
    return resp.get("events", [])


def save_event(session_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Append an event to the session (e.g., user msg, agent reply, tool call).

    AgentCore `create_event` API requires:
      - actorId        (string)         — pulled from payload['actor_id']
      - eventTimestamp (datetime)       — set here to now (UTC)
      - payload        (list of blocks) — wrap the dict into a single
                                          conversational block as required
                                          by the AgentCore wire format.

    Failures are logged and swallowed — chat must continue even if memory
    persistence fails (Bedrock Converse doesn't depend on this write)."""
    s = get_settings()
    actor_id = str(payload.get("actor_id") or payload.get("actorId") or "anonymous")
    text = str(payload.get("text") or "")
    role = str(payload.get("role") or "user").upper()
    if role not in ("USER", "ASSISTANT", "TOOL", "OTHER"):
        role = "USER"
    try:
        return bedrock_agentcore().create_event(
            memoryId=s.agentcore_memory_id,
            sessionId=session_id,
            actorId=actor_id,
            eventTimestamp=datetime.now(timezone.utc),
            payload=[{
                "conversational": {"role": role, "content": {"text": text}},
            }],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("memory.save_event failed (non-fatal): %s", str(exc)[:200])
        return None


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
