# Ontology Retail — CDK Infrastructure

Phase 2 산출물. AWS CDK TypeScript app으로 6개 스택을 정의:

| Stack | Region | Status | Purpose |
|---|---|---|---|
| `OntologyRetailNetwork` | ap-northeast-2 | ✅ Concrete | VPC, Subnets, NAT, SGs, VPC Endpoints |
| `OntologyRetailData` | ap-northeast-2 | 🚧 Stub | Neptune, Aurora, OpenSearch Serverless, S3 |
| `OntologyRetailAi` | ap-northeast-2 | 🚧 Stub | Bedrock KB, Guardrails, AgentCore Memory |
| `OntologyRetailCompute` | ap-northeast-2 | 🚧 Stub | ECS Cluster, ECR, Fargate Services |
| `OntologyRetailEdge` | ap-northeast-2 + us-east-1 | 🚧 Stub | CloudFront, Cognito, Lambda@Edge |
| `OntologyRetailObservability` | ap-northeast-2 | 🚧 Stub | CW Dashboard, Alarms |

## Prerequisites

```bash
node --version       # >= 18
npm --version        # >= 9
aws --version        # AWS CLI v2
aws sts get-caller-identity  # confirms credentials
```

## Setup

```bash
cd infra-cdk
npm install
```

## CDK Bootstrap (one-time per account/region)

```bash
# Primary region (Seoul)
npx cdk bootstrap aws://<account-id>/ap-northeast-2

# Edge region (us-east-1) — required for Lambda@Edge later
npx cdk bootstrap aws://<account-id>/us-east-1
```

## Deploy

```bash
# Inspect synth output
npm run synth

# Deploy network stack (foundation)
npm run deploy:network

# Deploy all stacks
npm run deploy:all
```

## Stack Dependency Graph

```
Network ──┬─→ Data ───────┐
          ├─→ Compute ────┼─→ Observability
          └─→ Ai ─────────┘
              ↑
Edge ─────────┘  (Cognito User Pool referenced by Compute/Ai for auth)
```

## Configuration

Tunable values are in `cdk.json` `context`:

| Key | Default | Notes |
|---|---|---|
| `ontology:projectName` | `ontology-retail` | Resource name prefix |
| `ontology:env` | `dev` | Environment tag |
| `ontology:primaryRegion` | `ap-northeast-2` | Seoul |
| `ontology:edgeRegion` | `us-east-1` | Lambda@Edge mandatory region |
| `ontology:vpcCidr` | `10.20.0.0/16` | Avoids reference repo `10.254.x.x` |
| `ontology:maxAzs` | `2` | ap-northeast-2a, 2c |
| `ontology:natGateways` | `1` | Cost optimization (single AZ NAT) |

Override at synth time:
```bash
npx cdk synth -c ontology:env=staging
```

## Cost Notes

Refer to design spec § 11 for full breakdown. Network stack baseline:
- VPC: free
- NAT Gateway: ~$40/mo
- VPC Endpoints (5 Interface × 2 AZ + 1 Gateway): ~$80/mo
- **Network total: ~$120/mo**
