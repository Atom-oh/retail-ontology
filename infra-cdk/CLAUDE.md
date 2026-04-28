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
- **AgentCore Memory via AwsCustomResource** — must use v3 explicit form + `fromStatements` IAM + underscore-only memory names. See [ADR-0001](../docs/decisions/0001-agentcore-memory-via-aws-custom-resource.md) for the four sequential bootstrap failures.
- **L2 CloudTrail emits empty EventSelectors** — CDK 2.150 bug. Use `CfnTrail` directly with manual bucket policy. See [ADR-0002](../docs/decisions/0002-cloudtrail-via-cfntrail-with-manual-bucket-policy.md).
- **Lambda@Edge can't read SSM/Secrets** — bake stable Cognito user-pool/client IDs into the inline source. CDK exports `UserPoolId` / `UserPoolClientId` / `UserPoolDomain` for drift detection. See [ADR-0003](../docs/decisions/0003-lambda-edge-stable-id-hardcode-strategy.md).
- **`experimental.EdgeFunction` drops `crossRegionReferences`** — same root cause as ADR-0003; covered in that ADR.
- **`update-user-pool-client` clobbers config** — never partial-update; drive Cognito UserPoolClient config from CDK only. See [ADR-0004](../docs/decisions/0004-cognito-user-pool-client-cdk-driven.md).

## Common tasks

```bash
cd infra-cdk

# Initial bootstrap (per-account, per-region)
npx cdk bootstrap aws://<account-id>/ap-northeast-2
npx cdk bootstrap aws://<account-id>/us-east-1   # for Lambda@Edge

# Synth all stacks
npx cdk synth

# Diff before deploy
npx cdk diff <StackName>

# Deploy single stack
npx cdk deploy OntologyRetailEdge

# Deploy all
npx cdk deploy --all
```

## Testing

```bash
# Snapshot tests for all 6 stacks (Template.fromStack().toJSON() vs committed snapshot)
cd infra-cdk && npx jest --ci

# Update snapshots after intentional infra change, then review the diff
cd infra-cdk && npx jest -u
```

Snapshot file at `test/__snapshots__/stacks.test.ts.snap` (~7700 lines, auto-generated). Test setup mirrors `bin/app.ts` exactly with deterministic test context (account `000000000000`, no `importVpcId`). When adding a new stack: add an instantiation block in `test/stacks.test.ts` and a corresponding `test()` block, then run with `-u` to commit the new snapshot.

CI runs `npx cdk synth --quiet --all` followed by `npx jest --ci` in the `cdk-synth` job (`.github/workflows/ci.yml`). Both gate the PR.

## Adding a new resource

1. Identify the right stack (data → data-stack, compute → compute-stack, etc.).
2. If the resource is shared across stacks, export it via `CfnOutput` with a stable `exportName` and import via `Fn.importValue` in the consumer stack.
3. Run `npx cdk diff` first; review IAM and security-group changes carefully.
4. Run `npx jest -u` and commit the snapshot diff alongside the code change.
5. Add or update the relevant ADR in `docs/decisions/` if the change is architectural.
