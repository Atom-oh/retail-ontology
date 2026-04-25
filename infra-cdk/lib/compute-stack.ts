import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface ComputeStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly vpc: ec2.IVpc;
  readonly albSg: ec2.ISecurityGroup;
  readonly webSg: ec2.ISecurityGroup;
  readonly apiSg: ec2.ISecurityGroup;
  // TODO Phase 2: wire from DataStack / AiStack
  //   readonly auroraSecret: secretsmanager.ISecret;
  //   readonly neptuneClusterEndpoint: string;
  //   readonly openSearchCollectionEndpoint: string;
  //   readonly knowledgeBaseId: string;
  //   readonly guardrailId: string;
  //   readonly agentCoreMemoryId: string;
}

export class ComputeStack extends Stack {
  // TODO Phase 2 outputs (consumed by EdgeStack):
  //   public readonly alb: elbv2.IApplicationLoadBalancer;
  //   public readonly webService: ecs.IFargateService;
  //   public readonly apiService: ecs.IFargateService;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { projectName, envName } = props;

    // TODO Phase 2 — Compute layer (spec § 6.2, § 5.3):
    //
    // 1. ECR repositories (×2):
    //    - ${projectName}-web    (Next.js image, ARM64)
    //    - ${projectName}-api    (FastAPI image, ARM64)
    //    - imageScanOnPush: true
    //    - lifecycleRules: keep last 10 images
    //
    // 2. ECS Cluster:
    //    - Fargate (no FARGATE_SPOT for demo stability)
    //    - containerInsights: true (V2)
    //    - vpc from props
    //
    // 3. IAM task roles:
    //    - ecs-task-role-web: CloudWatch Logs only
    //    - ecs-task-role-api: bedrock:InvokeModel (specific model ARNs),
    //                          bedrock:Retrieve, bedrock:RetrieveAndGenerate,
    //                          bedrock-agentcore:* (memory/runtime/gateway),
    //                          neptune-db:connect, aoss:APIAccessAll on collection,
    //                          secretsmanager:GetSecretValue on aurora secret,
    //                          s3:GetObject on raw-docs/uploads,
    //                          xray:Put*, logs:CreateLogStream/PutLogEvents
    //
    // 4. Application Load Balancer:
    //    - internet-facing: false (private DNS internal? or internet-facing for CF origin)
    //    - actually internet-facing=true (CloudFront origin) but SG locked to CF prefix list
    //    - subnets: PUBLIC
    //    - securityGroup: albSg
    //    - Listener :80 with rules per spec § 5.3:
    //        priority 10: path "/api/*" → tg-api (port 8000, target type ip)
    //        default:                   → tg-web (port 3000, target type ip)
    //    - Health checks: tg-web GET /api/health-web, tg-api GET /healthz
    //
    // 5. Fargate Services:
    //    - web (spec § 6.2): 0.5 vCPU / 1 GB / 2 task / ARM64
    //         taskDefinition: image from ECR, port 3000, env vars (NEXT_PUBLIC_*)
    //         service: securityGroup webSg, deploymentCircuitBreaker enabled
    //    - api (spec § 6.2): 1 vCPU / 2 GB / 2 task / ARM64
    //         taskDefinition: image from ECR, port 8000
    //         env: AURORA_SECRET_ARN, NEPTUNE_ENDPOINT, OPENSEARCH_ENDPOINT,
    //              BEDROCK_KB_ID, BEDROCK_GUARDRAIL_ID, AGENTCORE_MEMORY_ID,
    //              BEDROCK_RERANKER_INFERENCE_PROFILE_ARN
    //         secrets: AURORA_PASSWORD from secret
    //         service: securityGroup apiSg

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'compute');
    Tags.of(this).add('ManagedBy', 'cdk');
  }
}
