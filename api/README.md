# Phase 3 — FastAPI backend

Implements the API layer for scenarios A/B/C (spec § 4, § 7).

```
api/
├── main.py              # FastAPI app, lifespan, middleware, router mount
├── config.py            # Pydantic Settings — env vars from compute-stack task def
├── aws_clients.py       # boto3 client singletons
├── routers/
│   ├── health.py        # GET /healthz (ALB tg-api health)
│   ├── search.py        # POST /api/search (Scenario A)
│   ├── chat.py          # POST /api/chat — SSE stream (Scenario B)
│   ├── insights.py      # POST /api/insights (Scenario C)
│   └── ingest.py        # POST /api/ingest/pdf (Scenario C wow)
├── services/
│   ├── embedding.py     # Cohere Embed Multilingual v3 (Bedrock InvokeModel)
│   ├── search.py        # OpenSearch hybrid (BM25 Nori + KNN) + Bedrock Rerank
│   ├── neptune.py       # SigV4-signed openCypher / SPARQL
│   ├── kb.py            # Bedrock Knowledge Base lookup + RAG
│   ├── memory.py        # AgentCore Memory (session + 7d long-term)
│   ├── agent.py         # Bedrock Converse with tool-use orchestration
│   ├── guardrails.py    # ApplyGuardrail wrapper (PII scrub before Reranker)
│   └── ingest.py        # PDF→Claude(structured)→Neptune merge
├── requirements.txt
└── Dockerfile           # ARM64 python:3.12-slim, uvicorn 2 workers
```

## Local dev

```bash
cd /home/ec2-user/my-project/ontology-for-retail
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt

# Required env vars (compute-stack injects these; for local copy from secrets):
export AWS_REGION=ap-northeast-2
export AURORA_SECRET_ARN=arn:...:secret:ontology-retail-dev-aurora-credentials-XXXX
export NEPTUNE_ENDPOINT=ontology-retail-dev-neptune.cluster-xxx.ap-northeast-2.neptune.amazonaws.com
export OPENSEARCH_ENDPOINT=https://xxx.aoss.amazonaws.com
export OPENSEARCH_INDEX=ontology-retail-dev-kb-index
export BEDROCK_KB_ID=XXXXXXXXXX
export BEDROCK_GUARDRAIL_ID=XXXXXXXXXX
export BEDROCK_GUARDRAIL_VERSION=1
export AGENTCORE_MEMORY_ID=mem_xxx
export RAW_DOCS_BUCKET=ontology-retail-dev-raw-docs-<account-id>
export UPLOADS_BUCKET=ontology-retail-dev-uploads-<account-id>

uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

## Build & push to ECR

```bash
ACCOUNT=<account-id>
REGION=ap-northeast-2
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/ontology-retail-dev-api

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# Build for ARM64 (Fargate ARM64 spec)
docker buildx build --platform linux/arm64 \
  -t $REPO:latest \
  -f api/Dockerfile \
  --push .

# Trigger service redeploy
aws ecs update-service --cluster ontology-retail-dev-cluster \
  --service ontology-retail-dev-api --force-new-deployment --region $REGION
```

## Endpoints

| Path | Method | Scenario | Notes |
|---|---|---|---|
| `/healthz` | GET | — | ALB target group health (200 ok) |
| `/api/search` | POST | A | hybrid search + neptune subgraph for top-5 SKU |
| `/api/chat` | POST | B | SSE stream; emits `log` events for tool-call panel |
| `/api/insights` | POST | C | placeholder; Phase 4 wires Code Interpreter |
| `/api/ingest/pdf` | POST | C wow | PDF→Claude→Neptune (idempotent on sku_id) |

## Scenario B SSE event types

```
event: log         # tool call observability for right panel
event: delta       # streaming text chunk for chat UI
event: guardrail   # PII scrub or content block notification
event: stop        # final scrubbed message + end of turn
```

## Notes

- AWS service routing via VPC endpoints (when present) or NAT (CcOnBedrock VPC has both).
- Aurora credentials fetched at startup via `aws_clients.aurora_credentials()` —
  not via ECS Secret injection (cross-stack KMS cycle, see infra-cdk commit 9469251).
- Cross-Region Inference Profile for Reranker — IAM allows wildcards across regions
  (compute-stack ApiTaskRole `BedrockInvokeModels` statement).
