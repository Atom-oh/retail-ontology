"""Scenario B — POST /api/chat (SSE stream)."""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.services import agent

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=4, max_length=128)
    message: str = Field(min_length=1, max_length=4000)
    actor_id: Optional[str] = "anonymous"


@router.post("/chat")
def chat_endpoint(req: ChatRequest):
    def stream():
        for event in agent.converse_stream(
            session_id=req.session_id,
            user_message=req.message,
            actor_id=req.actor_id or "anonymous",
        ):
            yield f"event: {event['type']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
