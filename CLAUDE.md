# CLAUDE.md

Project memory for Claude Code. This file is auto-loaded into every session and should describe what this codebase is, how it is organized, and what conventions matter when changing it. Keep it under ~300 lines and update it when architectural decisions change.

## Project

`ontology-retail` is a 30–60 minute proof-of-concept demo for a Korean Retail/CPG knowledge graph that powers eight wow scenarios on AWS Bedrock + AgentCore + Neptune. It is a multi-runtime monorepo: Python FastAPI backend, Next.js 14 frontend, AWS CDK infrastructure, and a synthetic-data loader that doubles as a one-shot ECS task.

Custom domain: `https://retail-ontology.whchoi.net` (CloudFront + Lambda@Edge cookie auth → Cognito). Demo user: `demo / demo@whchoi.net`.

The five-persona spine (임산부, 4세 아이, 캠퍼, 민감성 피부, 글루텐 알레르기) drives every demo path. Scenario A–H plus the knowledge-graph object explorer must remain coherent for the same persona context.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend runtime | Python 3.12 on Fargate ARM64 |
| Backend framework | FastAPI + Pydantic v2 + uvicorn |
| Frontend runtime | Node.js 20 on Fargate ARM64 |
| Frontend framework | Next.js 14 App Router (standalone output) + React 18 + Tailwind |
| Graph DB | Amazon Neptune (openCypher endpoint) |
| Search | OpenSearch Serverless (Nori BM25 + Cohere KNN, RRF fusion) |
| Foundation models | Bedrock Sonnet 4.6 for chat/insights, Cohere embed-v4 for vectors, Cohere rerank-v3 |
| Memory | AgentCore Memory (short-term session + long-term user namespaces) |
| Sandbox | AgentCore Code Interpreter Firecracker microVM (matplotlib + NanumGothic) |
| Maps | react-simple-maps + d3-geo + Korean sido GeoJSON (KOSTAT 행정구역코드) |
| Auth | Cognito user pool + Lambda@Edge cookie auth at CloudFront |
| Edge | CloudFront distribution → ALB (HTTP origin, SG-locked to CF prefix list) |
| Compute | ECS Fargate ARM64, two-replica services (api + web) |
| IaC | AWS CDK v2 (TypeScript) — six stacks: network, data, compute, ai, edge, observability |

## Project Structure

```
ontology-retail/
├── api/                  Python 3.12 FastAPI backend
│   ├── routers/          Per-scenario endpoints (one file per scenario)
│   ├── services/         Bedrock / Neptune / OpenSearch / AgentCore wrappers
│   ├── middleware_auth.py Cognito JWT verification
│   ├── aws_clients.py    boto3 client factories (cached)
│   └── Dockerfile        Single image used as both API server and one-shot loader
├── web/                  Next.js 14 App Router frontend
│   ├── app/              Routes for scenarios A-G + objects + ops + meta
│   ├── components/       PersonaSwitch, GuidedTour, CytoscapeView, Sidebar
│   └── lib/api-client.ts Typed REST + SSE client
├── infra-cdk/            AWS CDK v2 infrastructure (TypeScript)
│   ├── bin/              Entry point — instantiates all stacks
│   └── lib/              network, data, compute, ai, edge, observability
├── data/                 Synthetic data generator + Neptune/OpenSearch loader
│   ├── load.py           CLI: --neptune --opensearch --from-s3
│   ├── public/           Standards adapters: inci.py, foodon.py, kfda.py, beauty_categories.py
│   └── output/           JSON/NDJSON outputs (also synced to S3)
├── ontology/mappings/    Standards CSV/JSON: INCI, FoodOn, GS1↔KFDA
├── docs/                 Architecture, ADRs, runbooks
└── scripts/              KB index init, Cognito provisioning, eval harness
```

## Key Commands

```bash
# Build API image (ARM64) and push
docker build --platform linux/arm64 -f api/Dockerfile -t <ecr>/ontology-retail-dev-api:<tag> .
docker push <ecr>/ontology-retail-dev-api:<tag>

# Build web image
docker build --platform linux/arm64 -f web/Dockerfile -t <ecr>/ontology-retail-dev-web:<tag> .

# Deploy infrastructure
cd infra-cdk && npx cdk deploy --all

# Force ECS rollout (after image push)
aws ecs update-service --cluster ontology-retail-dev-cluster --service ontology-retail-dev-api --force-new-deployment

# Reload synthetic data via one-shot ECS task (uses the API image with overridden command)
aws ecs run-task --cluster ontology-retail-dev-cluster --task-definition ontology-retail-dev-api \
  --overrides '{"containerOverrides":[{"name":"api","command":["python","-m","data.load","--neptune","--opensearch","--from-s3"]}]}'

# Frontend type check
cd web && npx tsc --noEmit

# Wow-query evaluation
python3 scripts/eval_wow_queries.py
```

## Conventions

### Code

- **Imports**: prefer relative imports inside `api/` (`from api.services import neptune`) — never circular. Use lazy imports (`from api.routers import logistics as _log` inside a function body) when one router needs another's helpers, to avoid circular imports and keep cold-start small.
- **Cypher**: parameters always passed as keyword `parameters={...}` to `neptune.open_cypher`. Never f-string interpolate user input into Cypher.
- **boto3 sessions**: `from api.aws_clients import session as boto_session` — `session` is `@lru_cache`-wrapped factory. Call `boto_session()` first, then `.client(...)` on the returned `Session`.
- **SSE event vocabulary**: every streaming endpoint uses the same shape — `{"type": "phase|delta|log|final|result", "data": {...}}`. The web client `streamSSE<T>` helper consumes them generically.
- **F-strings**: never escape quotes inside f-string expressions (`f"...{d[\"k\"]}..."` is a SyntaxError). Extract to a local variable first.
- **Markdown rendering**: chat and insights answers go through `react-markdown` v10 + `remark-gfm` under `.chat-markdown` styles.
- **Agent tools**: TOOL_SPECS in `api/services/agent.py` is the single registration point. New tools (e.g. `inventory_lookup`, `nearest_warehouses`, `shortest_path`) get a JSON Schema entry and a `_dispatch_tool` branch. Tool calls auto-stream as `log` SSE events and persist into the `_TRACE_BUF` ring buffer.

### Models

- All chat and insights Bedrock Converse calls use Sonnet 4.6 (env var `BEDROCK_CHAT_MODEL_ID=global.anthropic.claude-sonnet-4-6`). Do not silently downgrade to Haiku Lite.
- Reranker is Cohere `rerank-v3` via cross-region inference profile. Falls back to RRF order on any error.

### Infrastructure

- All Fargate tasks are ARM64. Building on Intel without `--platform linux/arm64` ships an x86 image that ECS rejects.
- ECS services use `:latest` plus a SHA-pinned tag. For deterministic rollouts, register a new task definition revision pinning the SHA-tagged image rather than relying on `:latest` cache invalidation.
- Neptune is in private subnets — `dev` EC2 cannot reach it directly. Run loaders as one-shot ECS tasks in the same SG.

### Security

- Origin auth: CloudFront forwards a Secrets-Manager-backed `X-Origin-Auth-Token` header. ALB security group restricts ingress to the AWS-managed `com.amazonaws.global.cloudfront.origin-facing` prefix list.
- Cognito: RS256 JWTs, JWKS cached with TTL, constant-time origin token comparison.
- Bedrock Guardrails apply on chat input scrub and insights answer output.
- See [SECURITY.md](SECURITY.md) for explicit demo trade-offs and production migration plan.

## Auto-Sync Rules

When a session-level decision changes any of the following, update the corresponding doc immediately rather than letting it drift:

- Adding a new scenario (A–Z badge): update sidebar in `web/components/Sidebar.tsx`, add page under `web/app/<slug>/`, add API router under `api/routers/<slug>.py`, register in `api/main.py`, document the route in [docs/api-reference.md](docs/api-reference.md), add a CHANGELOG entry, and add a step to `web/components/GuidedTour.tsx`.
- Adding a new Knowledge Graph node type: update `_TYPE_REGISTRY` in `api/routers/objects.py`, `TYPE_META` in `web/app/objects/[type]/page.tsx`, sidebar 객체 탐색 section in `web/components/Sidebar.tsx`, `_CLASSES`/`_RELATIONS` in `api/routers/ontology.py`, the home page chip group in `web/app/page.tsx`, and (if persistent in synthetic data) `data/schemas.py` + a generator in `data/synthetic/`.
- Adding a new agent tool: register in `api/services/agent.py:TOOL_SPECS` (JSON Schema), add a branch to `_dispatch_tool`, and update the system prompt with chaining hints if the tool depends on another (e.g., `semantic_search` → `inventory_lookup`).
- Adding a new domain or alias: update CloudFront alias, ACM cert (us-east-1), Cognito callback URLs (full re-PUT — `update-user-pool-client` clobbers config), API task-def `PUBLIC_DOMAIN` env, and Route53. Lambda@Edge derives `redirect_uri` from the request `Host` header so it adapts automatically.
- Changing an environment variable: update [.env.example](.env.example), CDK task-definition env block in `infra-cdk/lib/compute-stack.ts`, the env section in [README.md](README.md), and the deployment runbook in `docs/runbooks/`.
- Changing IAM scope: update [SECURITY.md](SECURITY.md) and the relevant ADR in `docs/decisions/`.

## Memory References

User-specific memory lives at `~/.claude/projects/-home-ec2-user-my-project-ontology-for-retail/memory/` (see `MEMORY.md` index). Project-specific knowledge belongs in `docs/decisions/` (ADRs) and module-level `CLAUDE.md` files.
