# api/CLAUDE.md — FastAPI backend

## Role

HTTP surface for all seven scenarios plus the knowledge-graph object explorer, ontology meta views, and operations console. Runs as `uvicorn api.main:app` on Fargate ARM64. The same image is reused as a one-shot loader via command override, so anything imported by `api.main` must also be importable inside the loader.

## Layout

- `routers/` — one file per API surface area: `auth, chat, health, ingest, insights, logistics, objects, ontology, ops, persona_match, price, safety, search, substitute`. Registered in `api/main.py:include_router`.
- `services/` — boto3 / Neptune / OpenSearch / AgentCore wrappers. Each service module owns one external dependency.
- `services/agent.py` — Bedrock Converse multi-turn with TOOL_SPECS (`semantic_search`, `kb_lookup`, `neptune_subgraph`, `memory_recall`, `inventory_lookup`, `nearest_warehouses`, `shortest_path`). The chat scenario (B) and the logistics inline panel both stream from `/api/chat`.
- `aws_clients.py` — `@lru_cache` factory functions for boto3 clients/sessions. **Always call as functions** (`session().client(...)`, not `session.client(...)`).
- `middleware_auth.py` — Cognito JWT verification (RS256, JWKS TTL cache, constant-time origin token compare).
- `config.py` — Pydantic settings, env-var hydration.
- `Dockerfile` — multi-stage Python 3.12-slim, `linux/arm64` only.

## Conventions

- **Cypher params**: pass as `parameters={...}` keyword argument to `neptune.open_cypher`. Positional 2nd arg is a TypeError (the function signature has `*` between query and parameters).
- **F-strings**: never escape quotes inside expressions (`f"...{d[\"k\"]}..."` is a SyntaxError). Extract a local variable first.
- **boto3 sessions**: `from api.aws_clients import session as boto_session` then `boto_session().client("ce", region_name="us-east-1")`.
- **SSE events**: every streaming endpoint must yield `{"type": "<phase|delta|log|final|result>", "data": {...}}`. The web client `streamSSE<T>` consumes this shape generically.
- **Bedrock model**: chat and insights both use `s.bedrock_chat_model_id` (Sonnet 4.6). Never silently downgrade to Haiku Lite.
- **Guardrails**: input scrub via `guardrails.apply` for chat and search; output scrub for insights answer. Failure is non-fatal.
- **Tool dispatch in agent.py**: tool calls are also recorded in `_TRACE_BUF` (in-process ring buffer for `/ops/trace`).

## Adding a new scenario

1. Create `api/routers/<slug>.py` with a `router = APIRouter(tags=["<slug>"])`.
2. Add `app.include_router(<slug>.router, prefix="/api")` in `api/main.py`.
3. Define request/response Pydantic models inline.
4. If invoking Bedrock, use `from api.aws_clients import bedrock_runtime` and the `s.bedrock_chat_model_id` model.
5. Document the route in `docs/api-reference.md`.
6. If long-running, also add an SSE streaming variant `/<slug>/stream` using the shared event vocabulary.

## Testing

- AST validate after edits: `python3 -c "import ast; ast.parse(open('api/routers/<file>.py').read())"`
- Run wow-query eval against deployed: `python3 scripts/eval_wow_queries.py`
- Local run requires VPN/SSM into the VPC for Neptune reachability — most demo work is done against the deployed instance.
