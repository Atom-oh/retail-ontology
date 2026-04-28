# infra-cdk/CLAUDE.md — AWS CDK v2 infrastructure

## Role

All infrastructure for the demo, organized as six CDK stacks. Targets `ap-northeast-2` for all data/compute and `us-east-1` for Lambda@Edge + ACM (CloudFront requirement).

## Stacks (`lib/`)

- `network-stack.ts` — VPC, public/private subnets, NAT, VPC endpoints (S3, Secrets Manager, etc.)
- `data-stack.ts` — Neptune cluster, OpenSearch Serverless collection, Aurora Serverless v2, S3 buckets (raw-docs, uploads, synthetic-data, ontology-snapshots), KMS keys.
- `compute-stack.ts` — ECS cluster, api/web Fargate services, ALB (HTTP-80), ECR repos, IAM task roles, CloudWatch log groups.
- `ai-stack.ts` — Bedrock Guardrails, Knowledge Base, AgentCore Memory store (`AwsCustomResource` because Memory has no native CFN type).
- `edge-stack.ts` — CloudFront distribution, Lambda@Edge auth function (`experimental.EdgeFunction`), Cognito user pool + client + domain.
- `observability-stack.ts` — CloudTrail (management events only), CloudWatch alarms, Cost Anomaly subscription on `Default-Services-Monitor`.

## Conventions

- **ARM64 everywhere** — all Fargate task definitions specify `cpuArchitecture: ecs.CpuArchitecture.ARM64`. Building x86 images by mistake will fail health checks.
- **AgentCore Memory CDK gotchas** — must use `AwsCustomResource` v3 explicit form + `fromStatements` IAM + underscore-only memory names. See `agentcore_gotchas.md` for the four sequential bootstrap failures we hit.
- **L2 CloudTrail emits empty EventSelectors** — CDK 2.150 bug. Use `CfnTrail` directly with manual bucket policy. See `cloudtrail_cdk_gotchas.md`.
- **Lambda@Edge can't read SSM/Secrets** — bake Cognito user-pool/client IDs into the inline source via TypeScript template strings at synth time. CDK exports `LambdaEdgeUserPoolId` / `LambdaEdgeClientId` so drift detection compares them against the runtime user-pool IDs.
- **`experimental.EdgeFunction` drops `crossRegionReferences`** — hardcode stable IDs for cross-region resources rather than relying on auto-generated logical IDs.
- **`update-user-pool-client` clobbers config** — never partial-update; always re-pass the full describe output. Memory note saved as `cognito_update_clobbers_config.md`.

## Common tasks

```bash
cd infra-cdk

# Initial bootstrap (per-account, per-region)
npx cdk bootstrap aws://061525506239/ap-northeast-2
npx cdk bootstrap aws://061525506239/us-east-1   # for Lambda@Edge

# Synth all stacks
npx cdk synth

# Diff before deploy
npx cdk diff <StackName>

# Deploy single stack
npx cdk deploy OntologyRetailEdge

# Deploy all
npx cdk deploy --all
```

## Adding a new resource

1. Identify the right stack (data → data-stack, compute → compute-stack, etc.).
2. If the resource is shared across stacks, export it via `CfnOutput` with a stable `exportName` and import via `Fn.importValue` in the consumer stack.
3. Run `npx cdk diff` first; review IAM and security-group changes carefully.
4. Add or update the relevant ADR in `docs/decisions/` if the change is architectural.
