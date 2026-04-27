import {
  Stack,
  StackProps,
  Tags,
  CfnOutput,
  Duration,
  Environment,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { experimental as cfExperimental } from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export interface EdgeStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly edgeEnv: Environment;
  readonly alb: elbv2.IApplicationLoadBalancer;
  /** Shared secret sent as X-Origin-Auth-Token CF custom origin header.
   *  API enforces this header — defense-in-depth even though CF↔ALB is HTTP. */
  readonly originAuthSecret: string;
}

export class EdgeStack extends Stack {
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;
  public readonly userPoolDomain: cognito.IUserPoolDomain;
  public readonly distribution: cloudfront.IDistribution;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const { projectName, envName, alb, originAuthSecret } = props;
    const isProd = envName === 'prod';
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const namePrefix = `${projectName}-${envName}`;

    // -------------------------------------------------------------------
    // 1. Cognito User Pool (admin-managed, self-signup off, MFA optional)
    // -------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${namePrefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 10,
        requireDigits: true,
        requireSymbols: false,
        requireLowercase: true,
        requireUppercase: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });
    this.userPool = userPool;

    // Groups for spec § 6.1 personas
    for (const groupName of ['shopper', 'md', 'admin']) {
      new cognito.CfnUserPoolGroup(this, `${groupName.charAt(0).toUpperCase()}${groupName.slice(1)}Group`, {
        userPoolId: userPool.userPoolId,
        groupName,
        description: `${groupName} role for ontology demo`,
      });
    }

    this.userPoolDomain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `${projectName}-${envName}-${this.account}` },
    });

    // -------------------------------------------------------------------
    // 2. Lambda@Edge (us-east-1, cross-region via experimental.EdgeFunction)
    //    Scaffold pass-through. Replace inline code with cognito-at-edge
    //    npm package for production JWT validation against Cognito JWKS.
    // -------------------------------------------------------------------
    // Lambda@Edge inline source. Production hardening: replace with
    // cognito-at-edge package — must validate JWT cookie via JWKS from
    //   https://cognito-idp.{REGION}.amazonaws.com/{POOL_ID}/.well-known/jwks.json
    // and 302 to Cognito Hosted UI on miss. Lambda@Edge constraints:
    // no env vars (config baked at synth via string replace), package <=1MB,
    // 5-second timeout on VIEWER_REQUEST.
    const edgeFnCode = [
      "'use strict';",
      "exports.handler = async (event) => {",
      "  const request = event.Records[0].cf.request;",
      "  // Scaffold pass-through. Auth enforcement lives in API layer until",
      "  // cognito-at-edge JWT validation is wired here.",
      "  return request;",
      "};",
    ].join('\n');

    const authEdgeFn = new cfExperimental.EdgeFunction(this, 'AuthEdgeFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: Duration.seconds(5),
      memorySize: 128,
      code: lambda.Code.fromInline(edgeFnCode),
    });

    // -------------------------------------------------------------------
    // 3. CloudFront Distribution
    //    Origin = ALB (HTTP). ALB SG allows only CF managed prefix list (Network).
    //    Caching disabled at default (dynamic app); static assets can override.
    // -------------------------------------------------------------------
    const albOrigin = new origins.LoadBalancerV2Origin(alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
      // Shared secret only known to CF and the API. Compensates for the
      // HTTP CF↔ALB plaintext path (spec § 5.3) — API rejects requests
      // without this header. ALB SG already restricts to CF prefix list,
      // so this is layered defense, not the only line.
      customHeaders: { 'X-Origin-Auth-Token': originAuthSecret },
    });

    const edgeLambdas: cloudfront.EdgeLambda[] = [{
      functionVersion: authEdgeFn.currentVersion,
      eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
    }];

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${namePrefix} ontology demo`,
      defaultBehavior: {
        origin: albOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        edgeLambdas,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          edgeLambdas,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      enableLogging: false,
      // Custom domain + ACM cert (us-east-1) deferred per spec § 16.
    });
    this.distribution = distribution;

    // -------------------------------------------------------------------
    // 4. Cognito User Pool Client (PKCE OAuth code flow against Hosted UI)
    //    Callback URLs reference distribution.domainName (CDK token resolved at deploy).
    // -------------------------------------------------------------------
    this.userPoolClient = userPool.addClient('AppClient', {
      userPoolClientName: `${namePrefix}-app-client`,
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: false },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`https://${distribution.domainName}/api/auth/callback`],
        logoutUrls: [`https://${distribution.domainName}/`],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(7),
      enableTokenRevocation: true,
    });

    // -------------------------------------------------------------------
    // 5. Tags + Outputs
    // -------------------------------------------------------------------
    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'edge');
    Tags.of(this).add('ManagedBy', 'cdk');

    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.domainName,
      exportName: `${namePrefix}-distribution-domain`,
    });
    new CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      exportName: `${namePrefix}-user-pool-id`,
    });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${namePrefix}-user-pool-client-id`,
    });
    new CfnOutput(this, 'UserPoolDomain', {
      value: this.userPoolDomain.domainName,
    });
    new CfnOutput(this, 'CognitoHostedUiUrl', {
      value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/oauth2/authorize`,
    });
  }
}
