import {
  Stack,
  StackProps,
  Tags,
  CfnOutput,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as neptune from 'aws-cdk-lib/aws-neptune';
import * as oss from 'aws-cdk-lib/aws-opensearchserverless';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface ComputeStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly vpc: ec2.IVpc;
  readonly albSg: ec2.ISecurityGroup;
  readonly webSg: ec2.ISecurityGroup;
  readonly apiSg: ec2.ISecurityGroup;
  readonly auroraSecret: secretsmanager.ISecret;
  readonly neptuneCluster: neptune.CfnDBCluster;
  readonly openSearchCollection: oss.CfnCollection;
  readonly knowledgeBaseId: string;
  readonly guardrailId: string;
  readonly guardrailVersion: string;
  readonly agentCoreMemoryParameterName: string;
  readonly s3Key: kms.IKey;
  readonly auroraKey: kms.IKey;
  readonly logsKey: kms.IKey;
  readonly rawDocsBucket: s3.IBucket;
  readonly uploadsBucket: s3.IBucket;
}

export class ComputeStack extends Stack {
  public readonly cluster: ecs.ICluster;
  public readonly webRepo: ecr.IRepository;
  public readonly apiRepo: ecr.IRepository;
  public readonly alb: elbv2.IApplicationLoadBalancer;
  public readonly webService: ecs.FargateService;
  public readonly apiService: ecs.FargateService;
  public readonly apiTaskRole: iam.IRole;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const {
      projectName, envName, vpc, albSg, webSg, apiSg,
      auroraSecret, neptuneCluster, openSearchCollection,
      knowledgeBaseId, guardrailId, guardrailVersion, agentCoreMemoryParameterName,
      s3Key, auroraKey, logsKey, rawDocsBucket, uploadsBucket,
    } = props;

    const isProd = envName === 'prod';
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const namePrefix = `${projectName}-${envName}`;

    // -------------------------------------------------------------------
    // 1. ECR repositories ×2 with lifecycle (keep last 10 images)
    // -------------------------------------------------------------------
    const ecrLifecycle: ecr.LifecycleRule[] = [
      { description: 'Keep last 10 images', maxImageCount: 10, rulePriority: 1 },
    ];
    this.webRepo = new ecr.Repository(this, 'WebRepo', {
      repositoryName: `${namePrefix}-web`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      lifecycleRules: ecrLifecycle,
      removalPolicy,
      emptyOnDelete: !isProd,
    });
    this.apiRepo = new ecr.Repository(this, 'ApiRepo', {
      repositoryName: `${namePrefix}-api`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      lifecycleRules: ecrLifecycle,
      removalPolicy,
      emptyOnDelete: !isProd,
    });

    // -------------------------------------------------------------------
    // 2. ECS Cluster (Fargate, container insights v2)
    // -------------------------------------------------------------------
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${namePrefix}-cluster`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      enableFargateCapacityProviders: true,
    });

    // -------------------------------------------------------------------
    // 3. Log groups (KMS-encrypted via logsKey)
    // -------------------------------------------------------------------
    // TODO P1 (spec § 6.5): re-enable KMS CMK encryption on log groups.
    // Direct encryptionKey on LogGroup with cross-stack key causes
    // CDK to auto-grant logs service on the key (in DataStack),
    // creating cycle DataStack → ComputeStack/TaskExecutionRole. Workaround:
    //   (a) move LogGroups to DataStack, or
    //   (b) move logsKey to a shared "secrets stack" both can ref, or
    //   (c) use logs.CfnLogGroup directly + manual key policy.
    // For scaffold, AWS-managed encryption is used.
    void logsKey;
    const webLogGroup = new logs.LogGroup(this, 'WebLogGroup', {
      logGroupName: `/aws/ecs/${namePrefix}/web`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });
    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/ecs/${namePrefix}/api`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });

    // -------------------------------------------------------------------
    // 4. IAM task roles (execution + per-service task roles)
    // -------------------------------------------------------------------
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: `${namePrefix}-ecs-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    // Cross-stack: use explicit policy statements (no grantX) to avoid
    // modifying KMS key / secret resource policies in DataStack (cycle).
    taskExecutionRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AuroraSecretRead',
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [auroraSecret.secretArn],
    }));
    taskExecutionRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AuroraKmsDecrypt',
      actions: ['kms:Decrypt'],
      resources: [auroraKey.keyArn],
    }));
    // logsKey not used (LogGroup encryption removed; see TODO P1 above).

    const webTaskRole = new iam.Role(this, 'WebTaskRole', {
      roleName: `${namePrefix}-ecs-task-role-web`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Next.js task role - minimal (logs only)',
    });

    const apiTaskRole = new iam.Role(this, 'ApiTaskRole', {
      roleName: `${namePrefix}-ecs-task-role-api`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'FastAPI task role - Bedrock/AgentCore/Neptune/OS/Aurora/S3',
    });
    this.apiTaskRole = apiTaskRole;

    // Bedrock model invoke (incl. cross-region inference profiles for Reranker)
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'BedrockInvokeModels',
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
        `arn:aws:bedrock:${this.region}::foundation-model/cohere.embed-multilingual-v3`,
        `arn:aws:bedrock:${this.region}::foundation-model/cohere.rerank-*`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        // Cross-region inference profile backends (us-east-1 / us-west-2 etc.)
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
        `arn:aws:bedrock:*::foundation-model/cohere.rerank-*`,
      ],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'BedrockKBAndGuardrails',
      actions: [
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
        'bedrock:ApplyGuardrail',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
        `arn:aws:bedrock:${this.region}:${this.account}:guardrail/*`,
      ],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AgentCoreFullAccess',
      actions: ['bedrock-agentcore:*'],
      resources: ['*'],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'NeptuneDbConnect',
      actions: ['neptune-db:connect', 'neptune-db:ReadDataViaQuery', 'neptune-db:WriteDataViaQuery'],
      resources: [
        `arn:aws:neptune-db:${this.region}:${this.account}:${neptuneCluster.attrClusterResourceId}/*`,
      ],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'OpenSearchServerlessAccess',
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollection.attrArn],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'XRayTracing',
      actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      resources: ['*'],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AuroraSecretRead',
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [auroraSecret.secretArn],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AuroraKmsDecrypt',
      actions: ['kms:Decrypt'],
      resources: [auroraKey.keyArn],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'S3RawDocsRead',
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [rawDocsBucket.bucketArn, `${rawDocsBucket.bucketArn}/*`],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'S3UploadsReadWrite',
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
      resources: [uploadsBucket.bucketArn, `${uploadsBucket.bucketArn}/*`],
    }));
    apiTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'S3KmsDecrypt',
      actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
      resources: [s3Key.keyArn],
    }));

    // -------------------------------------------------------------------
    // 5. OS Serverless data access policy for api task role
    // -------------------------------------------------------------------
    const collectionName = `${namePrefix}-os`;
    new oss.CfnAccessPolicy(this, 'OpenSearchApiTaskDataPolicy', {
      name: `${namePrefix}-os-api`,
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: ['aoss:DescribeCollectionItems'],
            },
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument',
              ],
            },
          ],
          Principal: [apiTaskRole.roleArn],
        },
      ]),
    });

    // -------------------------------------------------------------------
    // 6. Task definitions (ARM64 Fargate)
    //    NOTE: image references use ECR :latest. Until images are pushed,
    //    services will run with desiredCount but tasks fail to start. This
    //    is expected scaffold behavior — push images then redeploy services.
    // -------------------------------------------------------------------
    const arm64Platform: ecs.RuntimePlatform = {
      cpuArchitecture: ecs.CpuArchitecture.ARM64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };

    const webTaskDef = new ecs.FargateTaskDefinition(this, 'WebTaskDef', {
      family: `${namePrefix}-web`,
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: arm64Platform,
      executionRole: taskExecutionRole,
      taskRole: webTaskRole,
    });
    webTaskDef.addContainer('WebContainer', {
      containerName: 'web',
      image: ecs.ContainerImage.fromEcrRepository(this.webRepo, 'latest'),
      portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup: webLogGroup }),
      environment: {
        AWS_REGION: this.region,
        NEXT_PUBLIC_API_BASE_URL: '/api',
        NODE_ENV: isProd ? 'production' : 'development',
      },
    });

    const apiTaskDef = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
      family: `${namePrefix}-api`,
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: arm64Platform,
      executionRole: taskExecutionRole,
      taskRole: apiTaskRole,
    });
    apiTaskDef.addContainer('ApiContainer', {
      containerName: 'api',
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepo, 'latest'),
      portMappings: [{ containerPort: 8000, protocol: ecs.Protocol.TCP }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: apiLogGroup }),
      environment: {
        AWS_REGION: this.region,
        AURORA_SECRET_ARN: auroraSecret.secretArn,
        AURORA_DATABASE_NAME: 'ontology',
        NEPTUNE_ENDPOINT: neptuneCluster.attrEndpoint,
        NEPTUNE_PORT: '8182',
        OPENSEARCH_ENDPOINT: openSearchCollection.attrCollectionEndpoint,
        OPENSEARCH_INDEX: `${namePrefix}-kb-index`,
        BEDROCK_KB_ID: knowledgeBaseId,
        BEDROCK_GUARDRAIL_ID: guardrailId,
        BEDROCK_GUARDRAIL_VERSION: guardrailVersion,
        // SSM dynamic reference — resolved at compute deploy time so the
        // post-deploy AgentCore Memory script's update is picked up.
        AGENTCORE_MEMORY_ID: ssm.StringParameter.valueForStringParameter(
          this, agentCoreMemoryParameterName,
        ),
        BEDROCK_RERANKER_INFERENCE_PROFILE_ARN:
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/cohere.rerank-v3`,
        RAW_DOCS_BUCKET: rawDocsBucket.bucketName,
        UPLOADS_BUCKET: uploadsBucket.bucketName,
      },
      // Secrets fetched at app startup via boto3 from AURORA_SECRET_ARN
      // (cross-stack ecs.Secret.fromSecretsManager triggers auto-grant on
      //  the secret's KMS key in DataStack → cycle).
    });

    // -------------------------------------------------------------------
    // 7. ALB + Target groups + Listener rules (spec § 5.3)
    // -------------------------------------------------------------------
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `${namePrefix}-alb`,
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      idleTimeout: Duration.seconds(60),
      deletionProtection: isProd,
    });

    const webTg = new elbv2.ApplicationTargetGroup(this, 'WebTg', {
      targetGroupName: `${namePrefix}-tg-web`,
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/api/health-web',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: Duration.seconds(30),
    });
    const apiTg = new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
      targetGroupName: `${namePrefix}-tg-api`,
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/healthz',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: Duration.seconds(30),
    });

    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([webTg]),
      // open=false prevents CDK from auto-adding 0.0.0.0/0:80 ingress to
      // the ALB SG. SG only carries the CloudFront managed prefix list rule
      // (added in network-stack). Org compliance (Epoxy) deletes listeners
      // when the SG is wide-open even if a prefix list rule also exists.
      open: false,
    });
    listener.addAction('ApiPathRule', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
      action: elbv2.ListenerAction.forward([apiTg]),
    });

    // -------------------------------------------------------------------
    // 8. Fargate Services ×2 (desiredCount=2 per spec § 6.2)
    //    Note: tasks won't start until ECR images are pushed. To avoid
    //    deployment hang, we set minHealthyPercent=0 for first deploy.
    // -------------------------------------------------------------------
    this.webService = new ecs.FargateService(this, 'WebService', {
      serviceName: `${namePrefix}-web`,
      cluster: this.cluster,
      taskDefinition: webTaskDef,
      // desiredCount=0 for scaffold deploy — ECS Circuit Breaker would roll
      // back the stack if tasks fail to pull the not-yet-pushed :latest image.
      // Scale up via `aws ecs update-service --desired-count 2` after the
      // first `docker buildx build --push` completes.
      desiredCount: 0,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [webSg],
      enableExecuteCommand: !isProd,
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
    });
    this.webService.attachToApplicationTargetGroup(webTg);

    this.apiService = new ecs.FargateService(this, 'ApiService', {
      serviceName: `${namePrefix}-api`,
      cluster: this.cluster,
      taskDefinition: apiTaskDef,
      // desiredCount=0 for scaffold deploy — ECS Circuit Breaker would roll
      // back the stack if tasks fail to pull the not-yet-pushed :latest image.
      // Scale up via `aws ecs update-service --desired-count 2` after the
      // first `docker buildx build --push` completes.
      desiredCount: 0,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [apiSg],
      enableExecuteCommand: !isProd,
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
    });
    this.apiService.attachToApplicationTargetGroup(apiTg);

    // -------------------------------------------------------------------
    // 9. Tags + Outputs
    // -------------------------------------------------------------------
    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'compute');
    Tags.of(this).add('ManagedBy', 'cdk');

    new CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName, exportName: `${namePrefix}-alb-dns` });
    new CfnOutput(this, 'AlbArn', { value: this.alb.loadBalancerArn });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'WebRepoUri', { value: this.webRepo.repositoryUri });
    new CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new CfnOutput(this, 'ApiTaskRoleArn', { value: apiTaskRole.roleArn, exportName: `${namePrefix}-api-task-role-arn` });
  }
}
