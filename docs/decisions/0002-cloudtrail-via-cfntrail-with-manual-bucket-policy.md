# ADR-0002: Drop to L1 `CfnTrail` for management-only CloudTrail on CDK 2.150

- Status: Accepted
- Date: 2026-04-28
- Deciders: whchoi (solo SA)
- Tags: cdk, cloudtrail, observability, infra

## Context

P1 hardening required CloudTrail management-event logging across the demo account (audit-trail surface for Bedrock model invocations, Cognito admin actions, IAM changes). The natural fit on `aws-cdk-lib` 2.150 is the L2 `cloudtrail.Trail` construct.

In practice, the L2 emits an empty `EventSelectors: []` array even when only management events are configured. CloudFormation forwards the empty array to CloudTrail's API, which rejects it with the misleading error `Invalid request provided: The resources.type field value is not valid` (HTTP 400). Nothing in the synthesized template references `resources.type` — that error message is from the AdvancedEventSelectors API surface, but it surfaces even when only basic EventSelectors is set to `[]`.

The L2 internally uses `Lazy.any({ produce: () => this.eventSelectors })` to populate the property, which always materializes (even when empty). Newer CDK versions guard this with a length check; 2.150 does not.

## Decision

For management-events-only trails on CDK 2.150 (commit `dcb8a0f`), we use the L1 `cloudtrail.CfnTrail` directly and **omit `EventSelectors` entirely**. Because the L2 normally adds the CloudTrail S3 bucket policy automatically, the L1 path requires us to **add the bucket policy by hand** with two `iam.PolicyStatement` entries scoped to the trail ARN via `aws:SourceArn` condition.

The trail ARN is synthesized from convention (`arn:aws:cloudtrail:${region}:${account}:trail/${trailName}`) rather than read from `trail.attrArn`, because referencing `attrArn` from the bucket policy creates a circular CloudFormation dependency.

## Alternatives Considered

- **Wait for / upgrade to a newer CDK** — out of scope this iteration; the project is otherwise stable on 2.150.
- **Use AdvancedEventSelectors with explicit `resources` blocks** — viable but unnecessary for management-only logging; AdvancedEventSelectors are designed for data events and add cognitive load.
- **Provision CloudTrail out-of-band (CLI / Terraform)** — breaks the "infra is in CDK" invariant; rejected for the same reason as ADR-0001.
- **Status quo (no CloudTrail)** — fails the P1 audit-trail requirement.

## Consequences

### Positive

- Management-event audit trail provisioned declaratively in `infra-cdk/lib/observability-stack.ts`.
- Bucket policy is explicit and reviewable (the L2 hides it inside the construct).
- Pattern is reusable for any other CDK construct that needs the bucket-policy-by-hand workaround.

### Negative

- Two CloudTrail-related code paths now exist: the L1 + manual bucket policy here, and the L2 elsewhere if we ever provision a data-events trail. Maintainers must remember which is which.
- If we upgrade past CDK 2.150 and the L2 bug is fixed, this ADR should be revisited and the L1 swap reversed (one extra migration step).
- The synthesized trail ARN string is hardcoded by convention; if AWS changes ARN format, the bucket policy condition breaks silently.

### Neutral

- Without the bucket policy, the failure mode is `Incorrect S3 bucket policy is detected for bucket: …` — also not pointing at the missing principals or conditions. ADR includes the two required statements verbatim so operators can replicate.

## Implementation Notes

- File touched: `infra-cdk/lib/observability-stack.ts` (search for `CfnTrail`)
- Required bucket policy statements (paraphrased):
  - `s3:GetBucketAcl` for service principal `cloudtrail.amazonaws.com`, condition `StringEquals { aws:SourceArn = trailArn }`
  - `s3:PutObject` on `arn:aws:s3:::${bucket}/AWSLogs/${account}/*`, conditions `s3:x-amz-acl = bucket-owner-full-control` AND `aws:SourceArn = trailArn`
- Migration plan: when upgrading CDK past the L2 fix, rewrite to `new cloudtrail.Trail({ managementEvents: ReadWriteType.ALL })` and remove the manual bucket policy.

## References

- CDK issue tracker: search `cloudtrail.Trail empty EventSelectors`
- CloudTrail API doc: `EventSelectors` parameter constraints
- Project memory: `~/.claude/projects/-home-ec2-user-my-project-ontology-for-retail/memory/cloudtrail_cdk_gotchas.md`
