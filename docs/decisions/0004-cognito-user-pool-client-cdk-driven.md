# ADR-0004: Drive Cognito UserPoolClient configuration from CDK only

- Status: Accepted
- Date: 2026-04-28
- Deciders: whchoi (solo SA)
- Tags: cognito, cdk, security, auth

## Context

The demo's authentication flow uses a Cognito User Pool Client with Hosted UI for Lambda@Edge–driven cookie auth. The client config is dense: callback URLs, logout URLs, OAuth flows, OAuth scopes, supported identity providers, identity-providers/user-pool-client toggle, explicit auth flows, token validity windows, prevent-user-existence-errors, token revocation.

`aws cognito-idp update-user-pool-client` is **PUT semantics, not PATCH**. Any field not passed on the command line is reset to its default — usually `null` or empty array. This bit us mid-demo when a small one-flag tweak silently nulled `CallbackURLs`, `AllowedOAuthFlows`, `AllowedOAuthScopes`, `AllowedOAuthFlowsUserPoolClient` (false), and `SupportedIdentityProviders`. Every Cognito Hosted UI redirect afterward returned `error=redirect_mismatch`. The propagation latency (30–60 s) made the failure look intermittent.

There is no `--patch` flavor of this API; the AWS CLI passes through to the SDK, which passes through to a service-level PUT.

## Decision

All Cognito UserPoolClient configuration changes happen **exclusively through CDK source edits + `cdk deploy`**. The AWS Console UI and the `aws cognito-idp update-user-pool-client` CLI are off-limits as authoring surfaces for this resource.

Operators who need to inspect the live config use `aws cognito-idp describe-user-pool-client`. Mutations require editing `infra-cdk/lib/edge-stack.ts` and re-deploying. The CDK construct re-applies every property idempotently each deploy, so the PUT clobber cannot occur from this path.

## Alternatives Considered

- **Use AWS Console UI** — rejected; the Console silently calls the same PUT API and presents partial-config screens. Easy to forget a field. No version control.
- **CLI with mandatory `describe → mutate → update` round-trip** — works but error-prone (a 50+ field JSON payload edited by hand). Documented as the *emergency* fallback only.
- **Build a wrapper script that always re-PUTs the full config** — duplicates what CDK already provides; would have to track config in a second source of truth.
- **Status quo (mixed CLI + CDK authoring)** — already burned us once; the propagation latency makes the failure mode hard to debug and easy to repeat.

## Consequences

### Positive

- The CDK source is the single source of truth for the UserPoolClient. Diffs are reviewable; rollbacks are git operations.
- Idempotent re-application makes accidental clobbers impossible from the sanctioned path.
- The Auto-Sync Rules in `CLAUDE.md` (under "Adding a new domain or alias") name CDK as the authoritative location, reinforcing the discipline.

### Negative

- Any genuinely emergency change (e.g., production callback URL outage) requires a `cdk deploy` rather than a `aws cognito-idp` one-liner. Mitigation: document the *emergency* round-trip recipe in `docs/runbooks/` for break-glass scenarios.
- Operators unfamiliar with CDK have a higher barrier to entry. Mitigation: every UserPoolClient field has a comment in `edge-stack.ts` linking to its Cognito API doc.
- `cdk deploy edge` takes ~3 minutes vs. a 5-second CLI call. Acceptable for this demo's change frequency.

### Neutral

- Cognito post-update propagation latency (30–60 s) still applies to CDK-driven changes. Don't conclude a deploy failed if the first `/oauth2/authorize` after deploy returns `redirect_mismatch` — wait one minute and retry.

## Implementation Notes

- File touched: `infra-cdk/lib/edge-stack.ts` (search for `UserPoolClient`)
- Emergency recipe (break-glass only, document in `docs/runbooks/cognito-emergency-rotate.md`):
  ```bash
  aws cognito-idp describe-user-pool-client --user-pool-id $POOL --client-id $CLIENT > /tmp/cur.json
  jq '<edit>' /tmp/cur.json > /tmp/new.json
  aws cognito-idp update-user-pool-client --cli-input-json file:///tmp/new.json
  ```
- Drift detection: `cdk diff edge` after every infrastructure change; alert if Cognito client appears modified outside the CDK path.
- Tests: post-deploy smoke test in `.claude/commands/test-all.md` includes `curl -sI <cf-domain>/api/auth/login` to confirm Cognito redirect chain is intact.

## References

- AWS Cognito API doc: `UpdateUserPoolClient` — note about field defaults
- AWS CLI reference: `cognito-idp update-user-pool-client`
- Project memory: `~/.claude/projects/-home-ec2-user-my-project-ontology-for-retail/memory/cognito_update_clobbers_config.md`
- Related: `CLAUDE.md` Auto-Sync Rules, "Adding a new domain or alias"
