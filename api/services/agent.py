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
import time
from collections import deque
from threading import Lock
from typing import Any, Deque, Dict, Generator, List, Optional

from api.aws_clients import bedrock_runtime
from api.config import get_settings
from api.services import guardrails, kb, memory, neptune, search


# In-process tool-call trace ring buffer for /api/ops/trace.
# Per-API-instance only — with 2 ECS tasks behind ALB, trace queries land
# on whichever instance the ALB routed to. Adequate for a demo, not for
# durable observability.
_TRACE_BUF: Deque[Dict[str, Any]] = deque(maxlen=200)
_TRACE_LOCK = Lock()


def _push_trace(*, session_id: str, actor_id: str, tool: str, input_: Dict[str, Any]) -> None:
    with _TRACE_LOCK:
        _TRACE_BUF.append({
            "ts": time.time(),
            "session_id": session_id,
            "actor_id": actor_id,
            "tool": tool,
            "input": input_,
        })


def recent_traces(*, limit: int = 50, session_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return up to `limit` most recent tool-call trace entries, newest first.
    Optional `session_id` filter narrows to a single chat session."""
    with _TRACE_LOCK:
        snapshot = list(_TRACE_BUF)
    if session_id:
        snapshot = [e for e in snapshot if e.get("session_id") == session_id]
    return list(reversed(snapshot))[:max(1, min(limit, 200))]

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
    # ── Logistics tools (Scenario H + chat panel) ──────────────────────
    {
        "toolSpec": {
            "name": "nearest_warehouses",
            "description": (
                "특정 위치(서울/부산/광주 등 주요 도시명 또는 lat/lng)에서 가장 가까운 "
                "물류 거점을 거리순으로 반환. cold_only=true면 냉장 거점만."
            ),
            "inputSchema": {"json": {
                "type": "object",
                "properties": {
                    "region_name": {"type": "string", "description": "서울/부산/대구/인천/광주/대전/울산/세종/수원 등"},
                    "lat": {"type": "number"},
                    "lng": {"type": "number"},
                    "limit": {"type": "integer", "default": 5},
                    "cold_only": {"type": "boolean", "default": False},
                },
            }},
        }
    },
    {
        "toolSpec": {
            "name": "shortest_path",
            "description": "두 물류 거점 간 최단 경로(BFS, max 4 hops). 이름(예: '마컬 송파', '쿠팡 광주FC') 또는 wh_id 모두 허용.",
            "inputSchema": {"json": {
                "type": "object",
                "required": ["from_wh", "to_wh"],
                "properties": {
                    "from_wh": {"type": "string", "description": "출발 거점 이름 또는 wh_id"},
                    "to_wh":   {"type": "string", "description": "도착 거점 이름 또는 wh_id"},
                },
            }},
        }
    },
    {
        "toolSpec": {
            "name": "inventory_lookup",
            "description": "특정 거점의 재고 또는 특정 SKU의 거점별 재고 조회.",
            "inputSchema": {"json": {
                "type": "object",
                "properties": {
                    "wh_id":  {"type": "string", "description": "거점 ID"},
                    "sku_id": {"type": "string", "description": "상품 ID"},
                    "limit":  {"type": "integer", "default": 30},
                },
            }},
        }
    },
]


# Major Korean city centroids — used by nearest_warehouses to resolve a
# region_name to lat/lng without an extra Neptune round-trip. Matches
# data/synthetic/logistics.py warehouse jitter centers.
_REGION_COORDS: Dict[str, tuple] = {
    "서울": (37.5665, 126.9780), "seoul": (37.5665, 126.9780),
    "부산": (35.1796, 129.0756), "busan": (35.1796, 129.0756),
    "대구": (35.8714, 128.6014), "daegu": (35.8714, 128.6014),
    "인천": (37.4563, 126.7052), "incheon": (37.4563, 126.7052),
    "광주": (35.1595, 126.8526), "gwangju": (35.1595, 126.8526),
    "대전": (36.3504, 127.3845), "daejeon": (36.3504, 127.3845),
    "울산": (35.5384, 129.3114), "ulsan": (35.5384, 129.3114),
    "세종": (36.4801, 127.2890),
    "수원": (37.2636, 127.0286),
    "성남": (37.4449, 127.1389),
    "고양": (37.6584, 126.8320),
    "용인": (37.2411, 127.1776),
    "창원": (35.2280, 128.6811),
    "청주": (36.6424, 127.4890),
    "전주": (35.8242, 127.1480),
    "포항": (36.0190, 129.3435),
}


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
            _push_trace(
                session_id=session_id, actor_id=actor_id,
                tool=tu["name"], input_=tu.get("input") or {},
            )
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
    if name == "nearest_warehouses":
        return _tool_nearest_warehouses(args)
    if name == "shortest_path":
        return _tool_shortest_path(args)
    if name == "inventory_lookup":
        return _tool_inventory_lookup(args)
    raise ValueError(f"unknown tool: {name}")


# ─── Logistics tool implementations ────────────────────────────────────────
# Light wrappers around the openCypher queries used by api/routers/logistics.py
# so that the chat agent can answer logistics questions inline (Scenario H
# inline panel + Scenario B "냉장 거점 5개" type queries).

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    h = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return round(R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h)), 1)


def _tool_nearest_warehouses(args: Dict[str, Any]) -> Dict[str, Any]:
    region = (args.get("region_name") or "").strip()
    if region and region.lower() in _REGION_COORDS:
        lat, lng = _REGION_COORDS[region.lower() if region.isascii() else region]
    elif region in _REGION_COORDS:
        lat, lng = _REGION_COORDS[region]
    elif args.get("lat") is not None and args.get("lng") is not None:
        lat, lng = float(args["lat"]), float(args["lng"])
    else:
        # Default Seoul if neither region nor lat/lng provided.
        lat, lng = _REGION_COORDS["서울"]
    cold_only = bool(args.get("cold_only", False))
    limit = max(1, min(int(args.get("limit", 5)), 30))
    where = " WHERE coalesce(w.cold_chain, false) = true" if cold_only else ""
    rows = neptune.open_cypher(
        f"MATCH (w:Warehouse){where} "
        "RETURN w.wh_id AS wh_id, w.name_ko AS name_ko, w.type AS type, "
        "       w.region_code AS region_code, w.lat AS lat, w.lng AS lng, "
        "       w.cold_chain AS cold_chain"
    )
    scored: List[Dict[str, Any]] = []
    for r in rows:
        try:
            wlat = float(r.get("lat") or 0); wlng = float(r.get("lng") or 0)
        except (TypeError, ValueError):
            continue
        if wlat == 0 and wlng == 0:
            continue
        scored.append({
            "wh_id": r.get("wh_id"),
            "name_ko": r.get("name_ko"),
            "type": r.get("type"),
            "region_code": r.get("region_code"),
            "lat": wlat, "lng": wlng,
            "cold_chain": bool(r.get("cold_chain")),
            "distance_km": _haversine_km(lat, lng, wlat, wlng),
        })
    scored.sort(key=lambda x: x["distance_km"])
    return {
        "origin": {"lat": lat, "lng": lng, "region": region or "Seoul (default)"},
        "results": scored[:limit],
        "count": len(scored[:limit]),
    }


def _resolve_wh_id(name_or_id: str) -> Optional[str]:
    """Resolve a warehouse name fragment OR wh_id to a canonical wh_id."""
    if not name_or_id:
        return None
    rows = neptune.open_cypher(
        "MATCH (w:Warehouse {wh_id: $id}) RETURN w.wh_id AS wh_id LIMIT 1",
        parameters={"id": name_or_id},
    )
    if rows:
        return str(rows[0].get("wh_id") or "")
    rows = neptune.open_cypher(
        "MATCH (w:Warehouse) WHERE w.name_ko CONTAINS $q "
        "RETURN w.wh_id AS wh_id, w.name_ko AS name_ko LIMIT 1",
        parameters={"q": name_or_id},
    )
    if rows:
        return str(rows[0].get("wh_id") or "")
    return None


def _tool_shortest_path(args: Dict[str, Any]) -> Dict[str, Any]:
    from_q = str(args.get("from_wh") or args.get("from") or "")
    to_q = str(args.get("to_wh") or args.get("to") or "")
    f_id = _resolve_wh_id(from_q)
    t_id = _resolve_wh_id(to_q)
    if not f_id or not t_id:
        return {"found": False, "from_wh": from_q, "to_wh": to_q,
                "error": f"warehouse not found: from={from_q!r} to={to_q!r}"}
    if f_id == t_id:
        return {"found": True, "from_wh_id": f_id, "to_wh_id": t_id, "hops": [],
                "total_distance_km": 0.0, "total_transit_hours": 0.0}
    # Pull all routes once and BFS in Python — cheap (~200 routes max).
    edges = neptune.open_cypher(
        "MATCH (rt:Route) "
        "RETURN rt.route_id AS route_id, rt.from_wh_id AS from_id, "
        "       rt.to_wh_id AS to_id, rt.carrier_id AS carrier_id, "
        "       rt.distance_km AS distance_km, rt.transit_hours AS transit_hours"
    )
    adj: Dict[str, List[Dict[str, Any]]] = {}
    for e in edges:
        a, b = str(e.get("from_id") or ""), str(e.get("to_id") or "")
        if not a or not b:
            continue
        adj.setdefault(a, []).append({
            "to": b, "route_id": e.get("route_id"),
            "carrier_id": e.get("carrier_id"),
            "distance_km": float(e.get("distance_km") or 0),
            "transit_hours": float(e.get("transit_hours") or 0),
        })
    # BFS up to 4 hops.
    queue: List[List[Dict[str, Any]]] = [[{"node": f_id, "edge": None}]]
    seen = {f_id}
    while queue:
        path = queue.pop(0)
        last = path[-1]["node"]
        if len(path) > 5:
            continue
        for ed in adj.get(last, []):
            nxt = ed["to"]
            new_path = path + [{"node": nxt, "edge": ed}]
            if nxt == t_id:
                hops = []
                total_d = total_t = 0.0
                for step in new_path[1:]:
                    e = step["edge"]
                    hops.append({
                        "from_wh_id": e and adj_back_lookup(adj, e["route_id"]),
                        "route_id": e["route_id"],
                        "carrier_id": e["carrier_id"],
                        "distance_km": e["distance_km"],
                        "transit_hours": e["transit_hours"],
                        "to_wh_id": step["node"],
                    })
                    total_d += e["distance_km"]
                    total_t += e["transit_hours"]
                return {
                    "found": True, "from_wh_id": f_id, "to_wh_id": t_id,
                    "hops": hops,
                    "total_distance_km": round(total_d, 1),
                    "total_transit_hours": round(total_t, 1),
                }
            if nxt not in seen:
                seen.add(nxt)
                queue.append(new_path)
    return {"found": False, "from_wh_id": f_id, "to_wh_id": t_id,
            "error": "no path within 4 hops"}


def adj_back_lookup(adj: Dict[str, List[Dict[str, Any]]], route_id: str) -> Optional[str]:
    for a, edges in adj.items():
        for e in edges:
            if e.get("route_id") == route_id:
                return a
    return None


def _tool_inventory_lookup(args: Dict[str, Any]) -> Dict[str, Any]:
    wh_id = (args.get("wh_id") or "").strip()
    sku_id = (args.get("sku_id") or "").strip()
    limit = max(1, min(int(args.get("limit", 30)), 100))
    if wh_id:
        rows = neptune.open_cypher(
            "MATCH (i:Inventory)-[:HELD_AT]->(w:Warehouse {wh_id: $wh}) "
            "OPTIONAL MATCH (i)-[:OF_SKU]->(p:Product) "
            "RETURN i.inv_id AS inv_id, p.sku_id AS sku_id, p.name_ko AS sku_name, "
            "       i.on_hand_pallets AS on_hand, i.days_of_cover AS dov, "
            "       i.temperature AS temp "
            "ORDER BY i.on_hand_pallets DESC LIMIT $k",
            parameters={"wh": wh_id, "k": limit},
        )
        return {"wh_id": wh_id, "items": [dict(r) for r in rows]}
    if sku_id:
        rows = neptune.open_cypher(
            "MATCH (i:Inventory)-[:OF_SKU]->(p:Product {sku_id: $sku}) "
            "OPTIONAL MATCH (i)-[:HELD_AT]->(w:Warehouse) "
            "RETURN i.inv_id AS inv_id, w.wh_id AS wh_id, w.name_ko AS wh_name, "
            "       i.on_hand_pallets AS on_hand, i.days_of_cover AS dov "
            "ORDER BY i.on_hand_pallets DESC LIMIT $k",
            parameters={"sku": sku_id, "k": limit},
        )
        return {"sku_id": sku_id, "items": [dict(r) for r in rows]}
    return {"error": "either wh_id or sku_id is required"}
