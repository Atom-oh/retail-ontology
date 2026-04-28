# ADR-0003: Hardcode stable identifiers in Lambda@Edge inline code on CDK 2.150

- Status: Accepted
- Date: 2026-04-28
- Deciders: whchoi (solo SA)
- Tags: cdk, lambda-edge, cloudfront, cognito, infra

## Context

The CloudFront origin auth (cookie-based session check → Cognito redirect) runs in a Lambda@Edge function deployed via CDK's `experimental.EdgeFunction`. Because Lambda@Edge requires `us-east-1`, CDK auto-creates a sibling stack `edge-lambda-stack-<addr>` in us-east-1 to hold the function. The parent EdgeStack is in `ap-northeast-2`.

If the inline Lambda code embeds CDK Tokens from the parent stack — for example, `userPoolClient.userPoolClientId` or `distribution.domainName` — CDK needs an SSM-Parameter-based bridge to resolve the cross-region references. Setting `crossRegionReferences: true` on the parent EdgeStack would normally enable this.

On CDK 2.150, `experimental.EdgeFunction`'s constructor passes only `env` and `tags` to the auto-created auxiliary stack — it **drops `crossRegionReferences`**. Because `Stack.crossRegionReferences` is read-only after construction, there is no clean way to retrofit it onto the auxiliary stack. Pre-creating the aux stack with the same auto-derived ID (so `tryFindChild` returns ours) sounds clever, but Lambda@Edge replicas cannot be deleted while *any* CloudFront distribution references them — orphaning replicas indefinitely.

## Decision

For Lambda@Edge inline code that needs values from the parent (ap-northeast-2) stack, we **hardcode stable identifiers as string literals** and use `CfnOutput` to expose the CDK-resolved values for drift detection (commit `516c38e`). Specifically: the Cognito user pool ID, app-client ID, and OAuth domain are inlined into the Lambda source; corresponding `UserPoolId`, `UserPoolClientId`, and `UserPoolDomain` outputs in the parent stack let `cdk diff` surface drift if a future change rotates these resources.

The CloudFront distribution's domain name (`distribution.domainName`) is **not** hardcoded into the auxiliary stack — instead, the Lambda derives `redirect_uri` from the request `Host` header at runtime. This keeps the parent stack as the only place that depends on the CF domain.

## Alternatives Considered

- **SSM Parameter Store + manual custom resource reader** — works but adds two CloudFormation resources (parameter + custom resource Lambda) and a cold-start dependency on SSM. Acceptable but heavier than hardcoding for stable values.
- **Runtime SDK fetch (e.g., `cognito-idp:DescribeUserPoolClient`)** — adds 100-200ms of cold-start latency and an additional IAM permission to the Lambda role. Rejected because the Cognito user pool is not expected to be replaced over the demo lifetime.
- **Pre-create aux stack with matching ID** — discussed above; orphans replicas and was abandoned mid-flight.
- **Status quo (let inline code reference Tokens directly)** — fails synth with `crossRegionReferences` errors; cannot ship.

## Consequences

### Positive

- Lambda@Edge cold start stays at the minimum (no SSM read, no SDK call).
- All CDK-resolved values are visible as stack outputs, so `cdk diff` immediately surfaces drift.
- The pattern is documented in the file header (`infra-cdk/lib/edge-stack.ts`) so future readers see the trade-off without reading this ADR.

### Negative

- A future change that *replaces* the user pool or app client (rather than mutating it) would silently leave the Lambda pointing at the old IDs until someone notices the `cdk diff` output. Mitigation: `UserPoolId` etc. outputs are part of every deploy summary.
- The hardcoded values are now part of the auxiliary stack's source; rotating them is a code change, not a config change.
- The CloudFront-domain-from-Host-header trick assumes a single CloudFront distribution serves the auth flow. If we add a second domain, this logic needs revisiting.

### Neutral

- Same constraint applies to any future Lambda@Edge functions — keep CF-domain-dependent config in the parent stack only.

## Implementation Notes

- File touched: `infra-cdk/lib/edge-stack.ts` (`AuthLambdaCode` template literal)
- Outputs: `UserPoolId`, `UserPoolClientId`, `UserPoolDomain`
- Drift detection: every `cdk deploy` prints the outputs; CI can `aws cloudformation describe-stacks` and compare to the values inlined in source.
- Migration plan: when CDK's `experimental.EdgeFunction` propagates `crossRegionReferences` (or upstream upgrades), restore Token usage in the inline code and remove the hardcoded literals.

## References

- CDK issue tracker: search `EdgeFunction crossRegionReferences not propagated`
- Lambda@Edge docs: replicas and deletion semantics
- Project memory: `~/.claude/projects/-home-ec2-user-my-project-ontology-for-retail/memory/cloudtrail_cdk_gotchas.md` (section 2)
