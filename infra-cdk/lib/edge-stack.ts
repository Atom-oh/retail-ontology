import { Stack, StackProps, Tags, Environment } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface EdgeStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly edgeEnv: Environment;
  // TODO Phase 2: wire from ComputeStack
  //   readonly albDnsName: string;
  //   readonly albLoadBalancerArn: string;
}

export class EdgeStack extends Stack {
  // TODO Phase 2 outputs (consumed by ComputeStack via env vars or AiStack for callback URL):
  //   public readonly userPoolId: string;
  //   public readonly userPoolClientId: string;
  //   public readonly userPoolDomain: string;
  //   public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const { projectName, envName } = props;

    // TODO Phase 2 — Edge / Auth layer (spec § 6.1, § 10):
    //
    // 1. Cognito User Pool (in primary region, ap-northeast-2):
    //    - admin-managed users, self-signup OFF (spec § 10)
    //    - groups: shopper, md, admin
    //    - MFA: optional (TOTP)
    //    - password policy: 8+ chars, mix
    //    - mfaSecondFactor: { otp: true, sms: false }
    //    - removalPolicy: DESTROY for dev, RETAIN for prod
    //
    // 2. Cognito Hosted UI:
    //    - domain: `${projectName}-${envName}` (Cognito-managed cognito-idp.{region}.amazonaws.com)
    //    - or custom domain via Route 53 (deferred, spec § 16)
    //    - Korean labels via custom CSS
    //
    // 3. Cognito User Pool Client:
    //    - allowedOAuthFlows: AUTHORIZATION_CODE
    //    - allowedOAuthScopes: openid, email, profile
    //    - callbackUrls: [`https://${distribution}/api/auth/callback`]
    //    - logoutUrls: [`https://${distribution}/`]
    //
    // 4. Lambda@Edge (in EDGE region, us-east-1):
    //    - Use cloudfront.experimental.EdgeFunction OR separate cross-region stack
    //    - Runtime: Node.js 20.x (smallest cold start)
    //    - Code: cognito-at-edge pattern (Viewer Request)
    //         - validate JWT cookie via JWKS from Cognito
    //         - on miss: 302 to Hosted UI authorize endpoint
    //         - on hit: pass-through with x-cognito-* headers for downstream
    //    - role: lambda + edgelambda trust, CloudWatch Logs in us-east-1
    //
    // 5. ACM cert (us-east-1, only when custom domain confirmed — spec § 16):
    //    - SAN: [primary.example.com]
    //    - DNS-validated via Route 53
    //
    // 6. CloudFront Distribution:
    //    - origins:
    //        primary: ALB DNS (HTTP, port 80) — protected by SG to CF prefix list
    //        s3 static: optional for /_next/static
    //    - behaviors:
    //        default: ALB origin, allViewerExceptHostHeader policy, edgeLambdas[VIEWER_REQUEST]
    //        /api/*: pass-through, no caching, edgeLambdas
    //    - certificate: ACM us-east-1 (only with custom domain)
    //    - aliases: [custom.domain] (only with custom domain)
    //    - priceClass: PRICE_CLASS_200 (Asia covered, ex Africa/SA)
    //    - logging: optional, S3 bucket from DataStack
    //
    // 7. WAF (optional, us-east-1, spec § 10):
    //    - rate-based rule: 100 req/min per IP
    //    - geo-match: KR (allowed) + whitelist (defaults)
    //    - AWS Managed Common Rules (CommonRuleSet, KnownBadInputs)
    //
    // Cross-region pattern note:
    //   For Lambda@Edge + CloudFront, use cloudfront.experimental.EdgeFunction
    //   which auto-replicates from us-east-1 even if this stack runs in seoul,
    //   OR create a separate Stack(env=us-east-1) and import via SSM parameter.

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'edge');
    Tags.of(this).add('ManagedBy', 'cdk');
  }
}
