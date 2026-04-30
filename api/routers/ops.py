"""
Operations Console (Phase 4 P2) — /api/ops/{ingest,guardrail,memory,eval,cost}.

Read-only telemetry for the demo's "what's actually running" panel:
  • ingest    — Neptune node counts by label + OpenSearch doc count
  • guardrail — recent log entries with `guardrail` keyword from API CW logs
  • memory    — list AgentCore Memory records for a session (or recent sessions)
  • eval      — 30 wow-query pass/fail scoreboard (cached run output)
  • cost      — daily AWS spend (Bedrock / Neptune / OpenSearch / total) via
                Cost Explorer + last-N-day sparkline
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.aws_clients import bedrock_agentcore, session as boto_session
from api.config import get_settings
from api.services import agent as agent_svc, memory as memory_svc, neptune, search as search_svc

router = APIRouter(tags=["ops"])
logger = logging.getLogger("ontology.ops")


# ─── /ops/ingest ────────────────────────────────────────────────────────────

class IngestStatus(BaseModel):
    neptune: Dict[str, int]
    opensearch_docs: int
    opensearch_index: str


@router.get("/ops/ingest", response_model=IngestStatus)
def ingest_status() -> IngestStatus:
    """Counts of every node label + edge type in Neptune, plus OS doc count.
    Single round-trip per backend — meant to be cheap enough to refresh on
    page focus."""
    s = get_settings()
    neptune_counts: Dict[str, int] = {}
    label_q = (
        "MATCH (n) RETURN labels(n)[0] AS lbl, count(n) AS c "
        "ORDER BY c DESC"
    )
    try:
        for r in neptune.open_cypher(label_q):
            lbl = r.get("lbl") or "(none)"
            neptune_counts[str(lbl)] = int(r.get("c") or 0)
    except Exception as e:  # noqa: BLE001
        logger.warning("neptune label count failed: %s", e)

    edges_q = "MATCH ()-[r]->() RETURN type(r) AS rel, count(r) AS c ORDER BY c DESC"
    try:
        for r in neptune.open_cypher(edges_q):
            rel = r.get("rel") or "(none)"
            neptune_counts[f":{rel}"] = int(r.get("c") or 0)
    except Exception as e:  # noqa: BLE001
        logger.warning("neptune edge count failed: %s", e)

    os_count = 0
    try:
        from opensearchpy import AWSV4SignerAuth, OpenSearch, RequestsHttpConnection
        host = s.opensearch_endpoint.replace("https://", "").rstrip("/")
        creds = boto_session().get_credentials()
        auth = AWSV4SignerAuth(creds, s.aws_region, "aoss")
        client = OpenSearch(
            hosts=[{"host": host, "port": 443}],
            http_auth=auth, use_ssl=True, verify_certs=True,
            connection_class=RequestsHttpConnection, timeout=15,
        )
        os_count = int(client.count(index=s.opensearch_index).get("count", 0))
    except Exception as e:  # noqa: BLE001
        logger.warning("opensearch count failed: %s", e)

    return IngestStatus(
        neptune=neptune_counts,
        opensearch_docs=os_count,
        opensearch_index=s.opensearch_index,
    )


# ─── /ops/guardrail ─────────────────────────────────────────────────────────

class GuardrailEvent(BaseModel):
    timestamp: int
    message: str


class GuardrailResponse(BaseModel):
    events: List[GuardrailEvent]
    bedrock_guardrail_id: str


@router.get("/ops/guardrail", response_model=GuardrailResponse)
def guardrail_events(minutes: int = 60, limit: int = 40) -> GuardrailResponse:
    """Recent CW log events on the API service mentioning guardrail/intervention.
    Phase 4 placeholder until we wire an explicit guardrail-violation log
    sink — this surfaces whatever the app already emits on input/output scrub."""
    s = get_settings()
    logs = boto_session().client("logs", region_name=s.aws_region)
    end = int(time.time() * 1000)
    start = end - max(1, int(minutes)) * 60 * 1000
    try:
        resp = logs.filter_log_events(
            logGroupName="/aws/ecs/ontology-retail-dev/api",
            startTime=start, endTime=end,
            filterPattern='?guardrail ?intervention ?intervened ?scrub',
            limit=max(1, min(int(limit), 200)),
        )
        evts = [
            GuardrailEvent(timestamp=int(e["timestamp"]), message=str(e["message"])[:1000])
            for e in resp.get("events", [])
        ]
    except Exception as e:  # noqa: BLE001
        logger.warning("guardrail log fetch failed: %s", e)
        evts = []
    return GuardrailResponse(events=evts, bedrock_guardrail_id=s.bedrock_guardrail_id)


# ─── /ops/memory ────────────────────────────────────────────────────────────

class MemorySnapshotEvent(BaseModel):
    actor_id: Optional[str] = None
    role: Optional[str] = None
    text: Optional[str] = None
    event_timestamp: Optional[str] = None
    raw: Dict[str, Any] = Field(default_factory=dict)


class MemorySnapshot(BaseModel):
    memory_id: str
    session_id: Optional[str]
    events: List[MemorySnapshotEvent]


@router.get("/ops/memory", response_model=MemorySnapshot)
def memory_snapshot(session_id: Optional[str] = None, top_k: int = 30) -> MemorySnapshot:
    """If `session_id` provided, list its short-term events. Otherwise return
    an empty snapshot keyed to the configured AgentCore Memory."""
    s = get_settings()
    if not session_id:
        return MemorySnapshot(memory_id=s.agentcore_memory_id, session_id=None, events=[])
    try:
        events = memory_svc.list_events(session_id, top_k=top_k)
    except Exception as e:  # noqa: BLE001
        logger.warning("memory list_events failed: %s", e)
        events = []
    out: List[MemorySnapshotEvent] = []
    for ev in events:
        payload = ev.get("payload") or []
        text = None
        role = None
        if isinstance(payload, list) and payload:
            first = payload[0] or {}
            conv = first.get("conversational") or {}
            role = conv.get("role")
            text = (conv.get("content") or {}).get("text")
        out.append(MemorySnapshotEvent(
            actor_id=ev.get("actorId"),
            role=role,
            text=text,
            event_timestamp=str(ev.get("eventTimestamp") or ""),
            raw=ev,
        ))
    return MemorySnapshot(memory_id=s.agentcore_memory_id, session_id=session_id, events=out)


# ─── /ops/eval ──────────────────────────────────────────────────────────────

# Same 30 wow queries that scripts/eval_wow_queries.py runs against /api/search.
# Keeping inline (not importing scripts/) so the API doesn't load the CLI module.
_WOW_QUERIES: List[Dict[str, Any]] = [
    {"q": "여름철 민감성 피부에 좋은 선크림 추천해줘",         "kws": ["민감성", "선크림", "무기자차"]},
    {"q": "향료 무첨가 토너 추천",                              "kws": ["향료", "토너"]},
    {"q": "시카 진정 크림",                                     "kws": ["시카", "병풀"]},
    {"q": "민감성 피부 클렌저",                                 "kws": ["민감성", "클렌저"]},
    {"q": "홍조 진정 세럼",                                     "kws": ["홍조", "진정"]},
    {"q": "임산부도 사용 가능한 비건 화장품",                   "kws": ["임산부", "비건"]},
    {"q": "바쿠치올 들어간 안티에이징",                         "kws": ["바쿠치올", "주름"]},
    {"q": "카페인 없는 음료",                                   "kws": ["카페인", "디카페인"]},
    {"q": "임신 중에 안전한 선크림",                            "kws": ["임산부", "무기자차", "임신", "선크림", "선블록"]},
    {"q": "무알코올 라떼",                                      "kws": ["무알코올", "디카페인", "카페인", "무카페인", "라떼"]},
    {"q": "글루텐프리 4세 아이 간식, 100칼로리 이하",           "kws": ["글루텐프리", "어린이"]},
    {"q": "아이가 좋아하는 무첨가 시리얼",                      "kws": ["어린이", "무첨가"]},
    {"q": "100칼로리 이하 저당 스낵",                           "kws": ["저당", "저칼로리"]},
    {"q": "락토프리 우유",                                      "kws": ["락토프리", "락토", "저지방", "유당", "우유"]},
    {"q": "어린이 안전한 비타민",                               "kws": ["영유아", "비타민"]},
    {"q": "운동 후 단백질 25g 이상 음료",                       "kws": ["고단백", "단백질"]},
    {"q": "저당 시리얼바",                                      "kws": ["저당", "단백질바", "시리얼바", "저칼로리", "그래놀라"]},
    {"q": "출근길에 먹기 좋은 저칼로리 도시락",                 "kws": ["저칼로리", "출근길"]},
    {"q": "프로바이오틱스 장 건강",                             "kws": ["유산균", "프로바이오틱스"]},
    {"q": "BCAA 보충제",                                        "kws": ["단백질"]},
    {"q": "올리브영 베스트 10대 여드름 토너",                  "kws": ["여드름"]},
    {"q": "20대 여성 인기 시카 라인",                           "kws": ["시카"]},
    {"q": "나이아신아마이드 미백 세럼",                         "kws": ["나이아신아마이드", "미백"]},
    {"q": "레티놀 주름 개선",                                   "kws": ["레티놀", "주름개선"]},
    {"q": "히알루론산 보습 앰플",                               "kws": ["히알루론산", "보습"]},
    {"q": "캠핑갈 때 필요한 간편식",                            "kws": ["캠핑", "등산", "야외", "간편식", "휴대"]},
    {"q": "야식으로 먹기 좋은 컵라면",                          "kws": ["야식", "컵라면"]},
    {"q": "숙취해소 음료",                                      "kws": ["숙취", "헛개", "음료", "회복"]},
    {"q": "프로폴리스 면역력",                                  "kws": ["프로폴리스", "면역"]},
    {"q": "한방 안티에이징 크림",                               "kws": ["한방", "주름"]},
]


_eval_cache: Dict[str, Any] = {"updated_at": 0.0, "result": None}
_EVAL_CACHE_TTL_SEC = 600  # 10 min


class EvalRow(BaseModel):
    q: str
    keywords: List[str]
    hit_count: int
    passed: bool
    latency_ms: int
    error: Optional[str] = None


class EvalResponse(BaseModel):
    pass_rate: float
    passes: int
    total: int
    avg_latency_ms: int
    cached_at_unix: int
    rows: List[EvalRow]


@router.get("/ops/eval", response_model=EvalResponse)
def eval_status(run: bool = False) -> EvalResponse:
    """Return cached eval results, or run live if `run=true` (or cache stale)."""
    now = time.time()
    cached = _eval_cache.get("result")
    if cached and not run and (now - _eval_cache["updated_at"]) < _EVAL_CACHE_TTL_SEC:
        return cached  # type: ignore[return-value]

    rows: List[EvalRow] = []
    passes = 0
    latencies: List[int] = []
    for spec in _WOW_QUERIES:
        q = spec["q"]
        kws = spec["kws"]
        t0 = time.perf_counter()
        err: Optional[str] = None
        hits: List[Dict[str, Any]] = []
        try:
            hits = list(search_svc.hybrid_search(q, top_k=10))
        except Exception as e:  # noqa: BLE001
            err = str(e)[:200]
        latency_ms = int((time.perf_counter() - t0) * 1000)
        latencies.append(latency_ms)
        text_blob = " ".join(
            (h.get("text", "") + " " + json.dumps(h.get("metadata", {}), ensure_ascii=False))
            for h in hits[:5]
        ).lower()
        ok = any(k.lower() in text_blob for k in kws)
        if ok:
            passes += 1
        rows.append(EvalRow(
            q=q, keywords=kws, hit_count=len(hits), passed=ok,
            latency_ms=latency_ms, error=err,
        ))
    total = len(rows)
    response = EvalResponse(
        pass_rate=(passes / total) if total else 0.0,
        passes=passes, total=total,
        avg_latency_ms=int(sum(latencies) / max(len(latencies), 1)),
        cached_at_unix=int(now),
        rows=rows,
    )
    _eval_cache["updated_at"] = now
    _eval_cache["result"] = response
    return response


# ─── /ops/cost ──────────────────────────────────────────────────────────────
#
# Cost Explorer is region-fixed at us-east-1 regardless of where workloads
# run. We project daily spend for the demo's three big AWS line items:
#   - Bedrock (foundation models, reranker, embeddings)
#   - Neptune (cluster + storage)
#   - OpenSearch Serverless (OCU)
# plus a "total" rollup. Result is cached 60s — Cost Explorer is metered
# per request and we don't want refreshes to thrash it.


class CostPoint(BaseModel):
    date: str          # YYYY-MM-DD (start of day, UTC)
    amount: float      # USD


class CostService(BaseModel):
    name: str          # human-readable
    code: str          # AWS service code (Cost Explorer dimension)
    total: float       # sum over window
    yesterday: float   # last full day
    points: List[CostPoint]


class CostResponse(BaseModel):
    days: int
    currency: str = "USD"
    services: List[CostService]
    total: float
    yesterday: float
    points: List[CostPoint]
    note: Optional[str] = None


_cost_cache: Dict[str, Any] = {"at": 0.0, "key": "", "result": None}


_COST_SERVICES = [
    ("Bedrock",            "Amazon Bedrock"),
    ("Neptune",            "Amazon Neptune"),
    ("OpenSearch Serverless", "Amazon OpenSearch Service"),
]


@router.get("/ops/cost", response_model=CostResponse)
def cost_report(days: int = 7) -> CostResponse:
    days = max(1, min(int(days), 30))
    cache_key = f"d{days}"
    now = time.time()
    if (
        _cost_cache["result"] is not None
        and _cost_cache["key"] == cache_key
        and (now - _cost_cache["at"]) < 60
    ):
        return _cost_cache["result"]

    end = _dt.date.today()
    start = end - _dt.timedelta(days=days)
    note: Optional[str] = None

    try:
        ce = boto_session().client("ce", region_name="us-east-1")
    except Exception as e:  # noqa: BLE001
        logger.warning("cost explorer client init failed: %s", e)
        # Return an empty shell so the page renders an explanatory state
        # instead of a 500.
        empty_points = [
            CostPoint(date=(start + _dt.timedelta(days=i)).isoformat(), amount=0.0)
            for i in range(days)
        ]
        result = CostResponse(
            days=days, services=[], total=0.0, yesterday=0.0,
            points=empty_points, note=f"cost-explorer client unavailable: {e}",
        )
        _cost_cache.update({"at": now, "key": cache_key, "result": result})
        return result

    def _query(filter_obj: Optional[Dict[str, Any]]) -> List[CostPoint]:
        kwargs = {
            "TimePeriod": {"Start": start.isoformat(), "End": end.isoformat()},
            "Granularity": "DAILY",
            "Metrics": ["UnblendedCost"],
        }
        if filter_obj:
            kwargs["Filter"] = filter_obj
        try:
            resp = ce.get_cost_and_usage(**kwargs)
        except Exception as e:  # noqa: BLE001
            logger.warning("cost explorer get_cost_and_usage failed: %s", e)
            return []
        out: List[CostPoint] = []
        for row in resp.get("ResultsByTime", []):
            d = row.get("TimePeriod", {}).get("Start", "")
            amt = float(row.get("Total", {}).get("UnblendedCost", {}).get("Amount", 0) or 0)
            out.append(CostPoint(date=d, amount=round(amt, 4)))
        return out

    services: List[CostService] = []
    for name, code in _COST_SERVICES:
        pts = _query({"Dimensions": {"Key": "SERVICE", "Values": [code]}})
        if not pts:
            pts = [CostPoint(date=(start + _dt.timedelta(days=i)).isoformat(), amount=0.0)
                   for i in range(days)]
        total = round(sum(p.amount for p in pts), 4)
        yesterday = pts[-1].amount if pts else 0.0
        services.append(CostService(
            name=name, code=code, total=total, yesterday=yesterday, points=pts,
        ))

    total_pts = _query(None)
    if not total_pts:
        total_pts = [CostPoint(date=(start + _dt.timedelta(days=i)).isoformat(), amount=0.0)
                     for i in range(days)]

    result = CostResponse(
        days=days,
        services=services,
        total=round(sum(p.amount for p in total_pts), 4),
        yesterday=total_pts[-1].amount if total_pts else 0.0,
        points=total_pts,
        note=note,
    )
    _cost_cache.update({"at": now, "key": cache_key, "result": result})
    return result


# ─── /ops/trace ─────────────────────────────────────────────────────────────


class TraceEvent(BaseModel):
    ts: float
    session_id: str
    actor_id: str
    tool: str
    input: Dict[str, Any] = Field(default_factory=dict)


class TraceResponse(BaseModel):
    events: List[TraceEvent]
    total: int


@router.get("/ops/trace", response_model=TraceResponse)
def trace_events(limit: int = 50, session_id: Optional[str] = None) -> TraceResponse:
    """Recent tool-call traces from the in-process ring buffer (per API
    instance). With 2 ECS tasks behind ALB this is whichever instance the
    request lands on — adequate for a demo, not durable across restarts."""
    items = agent_svc.recent_traces(limit=limit, session_id=session_id)
    return TraceResponse(
        events=[
            TraceEvent(
                ts=float(it.get("ts") or 0),
                session_id=str(it.get("session_id") or ""),
                actor_id=str(it.get("actor_id") or "anonymous"),
                tool=str(it.get("tool") or ""),
                input=it.get("input") if isinstance(it.get("input"), dict) else {"_": it.get("input")},
            )
            for it in items
        ],
        total=len(items),
    )
