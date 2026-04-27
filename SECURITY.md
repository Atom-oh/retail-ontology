# Security posture — explicit demo trade-offs and production migration plan

This document records security decisions that an automated reviewer (Kiro)
correctly flagged as gaps, with the rationale for the demo posture and the
exact migration path for production cutover.

## 1. CloudFront ↔ ALB unencrypted (HTTP:80)

**Current**: ALB listener is HTTP on port 80. CloudFront origin protocol
policy is `HTTP_ONLY`. Traffic between CF edge POPs and the ALB origin is
not TLS-encrypted.

**Spec reference**: § 5.3 — *"데모 단계는 ALB 리스너 80(HTTP). CloudFront ↔
ALB 구간은 AWS 백본 + Origin Shield(선택)로 보호. 운영 단계는 ACM + ALB
:443으로 격상."*

**Defenses currently in place**:
- ALB Security Group restricts ingress to the AWS-managed CloudFront
  origin-facing prefix list (`com.amazonaws.global.cloudfront.origin-facing`).
  Direct internet→ALB is impossible.
- Org compliance (`Epoxy`) auto-deletes ALB listeners that have any
  `0.0.0.0/0` ingress, enforcing this prefix-list-only posture
  (commit `560844b`: addListener `open: false`).
- API middleware supports `REQUIRE_ORIGIN_AUTH=true` + `ORIGIN_AUTH_SECRET`
  for an additional shared-secret check on every CF→ALB request
  (defense-in-depth even over HTTP).

**Why HTTPS isn't enabled in the demo**:
- ALB HTTPS requires an ACM certificate.
- Public ACM certs require ownership of a domain (DNS validation).
- *.elb.amazonaws.com is AWS-owned, so we can't get a public cert for it.
- Self-signed certs work for ALB but **CloudFront refuses to validate
  self-signed origin certificates** — origin protocol must be HTTPS_ONLY
  with a chain CF accepts.
- ACM Private CA solves this but costs ~$400/mo — disproportionate for
  a demo.

**Production migration**:
1. Acquire/assign a custom domain (e.g., `demo.example.com`).
2. Issue ACM cert in us-east-1 for the CF distribution alias.
3. Issue ACM cert in ap-northeast-2 for the ALB (covering the ALB's
   custom domain entry, e.g., `origin-demo.example.com`).
4. CDK changes:
   - `EdgeStack`: add `aliases` + `certificate` to `cloudfront.Distribution`.
   - `ComputeStack`: add 443 listener with the seoul ACM cert; redirect 80→443.
5. Set `REQUIRE_ORIGIN_AUTH=true` permanently to keep the layered defense.

## 2. Lambda@Edge auth is no-op + API auth opt-out by default

**Current**: `experimental.EdgeFunction` returns the request unchanged.
API `AuthMiddleware` runs but defaults to `DEMO_PUBLIC_MODE=true`, which
bypasses the JWT check.

**Spec reference**: § 6.1 — *"admin-managed users (`lotte@demo`,
`shinsegae@demo` 등), self-signup off, 그룹: `shopper`/`md`/`admin`"*

**Why it's bypassed in the demo**:
- The demo is invitation-only with a known URL — public access is
  acceptable for the 30–60 minute live demo session.
- Cognito Hosted UI is deployed and ready (`UserPoolId`,
  `UserPoolClientId`, `UserPoolDomain` outputs from EdgeStack).
- The app does not store user-identifying data — synthetic personas only.
- Wiring full auth before basic data flow is verified inverts the
  ROI: auth without working scenarios is no demo.

**Migration to enforced auth (1–2 hour follow-up)**:
1. **Lambda@Edge JWT validation**: replace the inline pass-through in
   `lib/edge-stack.ts` with the `cognito-at-edge` npm package implementation
   (~50 lines). Bake the User Pool ID + Client ID at synth time via
   string replacement in the inline code (Lambda@Edge has no env vars).
2. **API enforced auth**: set ECS task env `DEMO_PUBLIC_MODE=false`.
   Force-new-deployment picks it up. `AuthMiddleware._verify_jwt` then
   rejects all unauthenticated requests except `/healthz`.
3. **Strengthen JWT verification**: current code does structural checks +
   kid match (sufficient with edge JWT validation in front). Production
   should use `python-jose` for full RS256 signature verification using
   the JWKS public key. ~10 LOC change in `_verify_jwt`.
4. **Cognito user provisioning script**: `scripts/provision_cognito_users.sh`
   creates `lotte@demo`, `shinsegae@demo`, etc. with temporary passwords,
   adding to `shopper` / `md` groups for scenario routing.

## 3. Other accepted demo trade-offs (P1 backlog)

- **CloudWatch Logs CMK**: removed customer-managed key encryption
  due to cross-stack KMS cycle. Currently AWS-managed CMK
  (commit `9469251`). Production fix: relocate LogGroups to DataStack
  (where the KMS key lives) so the cycle disappears.
- **CloudTrail Bedrock data events**: not enabled. Compliance audit
  trail for Bedrock model invocations is missing. Production fix:
  add `CfnTrail` with EventSelectors for
  `AWS::Bedrock::ModelInvocation` in ObservabilityStack.
- **ALB access logs to S3 with 30-day retention**: not enabled. Production
  fix: `accessLogs.bucket` on ALB construction in ComputeStack pointing
  to a new dedicated S3 bucket in DataStack.
- **AWS Cost Anomaly Detection**: not enabled. Production fix: add
  `CfnCostCategory` + `CfnAnomalyMonitor` in ObservabilityStack.

All four items are tracked in spec § 10/§ 11.2 and are blocked on
nothing technical — they're ~1 hour of CDK work and were deprioritized
behind getting the wow scenarios working end-to-end.

## Decision log

| # | Issue | Severity (Kiro) | Demo posture | Migration trigger |
|---|---|---|---|---|
| 1 | CF↔ALB plaintext | HIGH | Accepted, prefix-list-only SG + optional X-Origin-Auth | Custom domain assigned |
| 2 | Edge auth no-op | HIGH | Accepted, demo is private URL | Real users / public exposure |
| 3 | API auth bypass | HIGH | Opt-in via `DEMO_PUBLIC_MODE=false` | Cognito users provisioned |
| 4 | Logs AWS-managed key | MED | Accepted, encryption still active | Production deployment |
| 5 | No CT data events | MED | Accepted, deferred | Compliance audit requirement |
| 6 | No ALB access logs | MED | Accepted, deferred | Forensics need |

Tracked: `~/.claude/projects/.../memory/agentcore_gotchas.md` and this file.
