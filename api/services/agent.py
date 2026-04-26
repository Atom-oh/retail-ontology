"""
Conversational agent for Scenario B.

Implementation strategy — we use Bedrock Converse API with tool-use directly
rather than AgentCore Runtime; this gives explicit control over tool calls
displayed in the right-side log panel (spec § 4.2 wow moment).

Tools exposed to the model:
  - search.semantic       → reuses Scenario A pipeline
  - kb.retrieve           → Bedrock Knowledge Base
  - neptune.query         → openCypher subgraph fetch
  - memory.recall         → AgentCore Memory long-term
"""
from __future__ import annotations

import json
from typing import Any, Dict, Generator, List

from api.aws_clients import bedrock_runtime
from api.config import get_settings
from api.services import guardrails, kb, memory, neptune, search

TOOL_SPECS = [
    {
        "toolSpec": {
            "name": "semantic_search",
            "description": "한국어 의미 검색. 상품/리뷰 SKU 후보를 반환.",
            "inputSchema": {"json": {
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": {"type": "string", "description": "검색어"},
                    "top_k": {"type": "integer", "default": 10},
                },
            }},
        }
    },
    {
        "toolSpec": {
            "name": "kb_lookup",
            "description": "Bedrock Knowledge Base에서 비정형 문서(매뉴얼/리뷰) 검색.",
            "inputSchema": {"json": {
                "type": "object",
                "required": ["query"],
                "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}},
            }},
        }
    },
    {
        "toolSpec": {
            "name": "neptune_subgraph",
            "description": "Neptune 그래프에서 SKU 주변 서브그래프 조회 (Cytoscape 표시용).",
            "inputSchema": {"json": {
                "type": "object",
                "required": ["sku_ids"],
                "properties": {"sku_ids": {"type": "array", "items": {"type": "string"}},
                               "hops": {"type": "integer", "default": 2}},
            }},
        }
    },
    {
        "toolSpec": {
            "name": "memory_recall",
            "description": "사용자 장기 메모리 회수 (페르소나 선호/제약).",
            "inputSchema": {"json": {
                "type": "object",
                "required": ["actor_id", "query"],
                "properties": {"actor_id": {"type": "string"}, "query": {"type": "string"}},
            }},
        }
    },
]


SYSTEM_PROMPT = (
    "당신은 한국 Retail/CPG 쇼퍼 어시스턴트입니다. 사용자의 라이프스타일·관심사를 "
    "memory_recall로 먼저 확인하고, 적절한 도구를 호출해 답변합니다. 임산부에게 "
    "카페인/알코올, 미성년에게 성인 콘텐츠는 절대 권유하지 않습니다."
)


def converse_stream(
    *, session_id: str, user_message: str, actor_id: str = "anonymous",
) -> Generator[Dict[str, Any], None, None]:
    """
    SSE-style generator. Yields dicts: {"type": "...", "data": {...}}
      - "log": tool call observability for right-panel
      - "delta": text chunk for chat UI
      - "stop": end of response
    """
    s = get_settings()
    safe_msg, intervened = guardrails.apply(user_message, source="INPUT")
    if intervened:
        yield {"type": "guardrail", "data": {"action": "input_scrub"}}

    memory.save_event(session_id, {"role": "user", "text": safe_msg, "actor_id": actor_id})

    history: List[Dict[str, Any]] = [
        {"role": "user", "content": [{"text": safe_msg}]},
    ]

    for _ in range(8):  # max tool-use rounds
        resp = bedrock_runtime().converse(
            modelId=s.bedrock_chat_model_id,
            system=[{"text": SYSTEM_PROMPT}],
            messages=history,
            toolConfig={"tools": TOOL_SPECS},
            inferenceConfig={"maxTokens": 2048, "temperature": 0.4},
        )
        msg = resp["output"]["message"]
        history.append(msg)

        tool_uses = [b["toolUse"] for b in msg["content"] if "toolUse" in b]
        text_blocks = [b["text"] for b in msg["content"] if "text" in b]

        for t in text_blocks:
            yield {"type": "delta", "data": {"text": t}}

        if not tool_uses:
            break

        tool_results: List[Dict[str, Any]] = []
        for tu in tool_uses:
            yield {"type": "log", "data": {"tool": tu["name"], "input": tu["input"]}}
            try:
                result = _dispatch_tool(tu["name"], tu["input"], actor_id=actor_id)
                tool_results.append({
                    "toolResult": {"toolUseId": tu["toolUseId"],
                                   "content": [{"json": result}], "status": "success"},
                })
            except Exception as e:  # noqa: BLE001
                tool_results.append({
                    "toolResult": {"toolUseId": tu["toolUseId"],
                                   "content": [{"text": str(e)}], "status": "error"},
                })
        history.append({"role": "user", "content": tool_results})

    final_text = "\n".join(
        b["text"] for m in history if m["role"] == "assistant"
        for b in m["content"] if "text" in b
    )
    safe_out, _ = guardrails.apply(final_text, source="OUTPUT")
    memory.save_event(session_id, {"role": "assistant", "text": safe_out})
    yield {"type": "stop", "data": {"final": safe_out}}


def _dispatch_tool(name: str, args: Dict[str, Any], *, actor_id: str) -> Any:
    if name == "semantic_search":
        return [dict(h) for h in search.hybrid_search(args["query"], top_k=args.get("top_k", 10))]
    if name == "kb_lookup":
        return [dict(r) for r in kb.lookup(args["query"], top_k=args.get("top_k", 5))]
    if name == "neptune_subgraph":
        return neptune.subgraph_for_skus(args["sku_ids"], hops=args.get("hops", 2))
    if name == "memory_recall":
        aid = args.get("actor_id") or actor_id
        return memory.retrieve_long_term(aid, args["query"])
    raise ValueError(f"unknown tool: {name}")
