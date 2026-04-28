# ADR-0001: Provision Bedrock AgentCore Memory via CDK `AwsCustomResource`

- Status: Accepted
- Date: 2026-04-28
- Deciders: whchoi (solo SA)
- Tags: cdk, agentcore, bedrock, infra

## Context

The demo's conversational agent (Scenario B) and personalization layer rely on Bedrock AgentCore Memory for short-term session context and long-term per-user namespaces. As of `aws-cdk-lib` 2.150, AgentCore has no L1 or L2 construct — the only declarative path from CDK is `cr.AwsCustomResource`, which generates a Lambda-backed custom resource that calls the AWS SDK directly.

Empirically, four sequential bootstrap failures hit during initial provisioning, each at a different abstraction layer (commits `c5768e7` → `6b590f6` → `941d17b` → `d7907e5`). The errors did not point at their root causes, so each had to be debugged independently. AgentCore is a newer service whose SDK package name, IAM action prefix, API parameter shape, and resource-naming rules don't follow the heuristics that CDK's auto-mapping uses for older services.

## Decision

We provision AgentCore Memory using `cr.AwsCustomResource` with **explicit, hand-written values** at every layer — no reliance on CDK auto-derivation. Specifically:

1. **API parameters**: use `namespaceTemplates` (plural + `Templates` suffix) with `{actorId}` / `{sessionId}` placeholders; require `memoryExecutionRoleArn` whose trust principal is `bedrock-agentcore.amazonaws.com` and that holds `bedrock:InvokeModel`.
2. **SDK v3 package**: pass the explicit string `'@aws-sdk/client-bedrock-agentcore-control'` and action `'CreateMemoryCommand'`; do **not** rely on CDK's PascalCase auto-mapping (which produces the wrong name `bedrockagentcorecontrol`).
3. **IAM policy**: build with `cr.AwsCustomResourcePolicy.fromStatements(...)` and grant `bedrock-agentcore:CreateMemory|DeleteMemory|GetMemory|UpdateMemory|ListMemories` plus `iam:PassRole` on the memory execution role ARN. Do **not** use `fromSdkCalls()` (which derives the wrong prefix `bedrock-agentcore-control:*`).
4. **Resource name**: enforce regex `^[a-zA-Z][a-zA-Z0-9_]{0,47}$` — convert any kebab-case prefix with `replace(/-/g, '_')` before passing the name.

## Alternatives Considered

- **Wait for an L2 construct** — not feasible on the demo timeline; AgentCore is still pre-GA in some regions.
- **Provision out-of-band via CLI script** (`scripts/create_agentcore_memory.sh`) — works but breaks the "infra is in CDK" invariant; we already use a script for *bootstrap* but want the Memory resource itself declarative for replays.
- **Step Functions / Lambda orchestrator** — overengineered for a single resource; the failure surface (and code volume) is larger than `AwsCustomResource`.
- **Status quo (don't use AgentCore Memory)** — would force us to roll our own session/long-term memory in DynamoDB or Redis; Bedrock AgentCore Memory is the differentiating capability for the wow demo, so this option contradicts the project goal.

## Consequences

### Positive

- AgentCore Memory is provisioned declaratively in `infra-cdk/lib/ai-stack.ts`; replays are idempotent.
- Future Bedrock services that ship without L2 constructs can follow the same four-layer-explicit pattern.
- Failure modes documented in code comments next to each gotcha (`@see ADR-0001`).

### Negative

- The pattern is verbose (~40 lines per memory resource) compared to a hypothetical L2 (`new agentcore.Memory(...)`).
- When AWS publishes an L1/L2, this code becomes legacy and must be migrated — but the AwsCustomResource form will continue to work as a fallback.
- Stuck-state recovery is manual: failed AgentCore Memory CRs cannot be deleted on rollback because the Lambda role uses pre-fix permissions. Needs `aws cloudformation delete-stack --retain-resources <logical-id>` after status reaches `DELETE_FAILED`.

### Neutral

- The same four gotchas (API shape / SDK package / IAM prefix / name regex) recur for AgentCore Browser, Code Interpreter, and Gateway resources. Operators should expect to apply this ADR's pattern when adding any new AgentCore primitive.

## Implementation Notes

- File touched: `infra-cdk/lib/ai-stack.ts` (search for `MemoryCustomResource`)
- Bootstrap script: `scripts/create_agentcore_memory.sh` (CLI-based equivalent kept for emergency reseed)
- Stuck stack recovery: `aws cloudformation delete-stack --retain-resources MemoryCustomResource …`
- Drift detection: CDK output `AgentCoreMemoryArn` exported; runtime API verifies presence on cold start.

## References

- AWS Labs samples: `awslabs/agentcore-samples` → `01-tutorials/04-AgentCore-memory/`
- CDK source: `aws-cdk-lib/custom-resources/lib/aws-custom-resource/aws-custom-resource.ts`
- Project memory: `~/.claude/projects/-home-ec2-user-my-project-ontology-for-retail/memory/agentcore_gotchas.md`
