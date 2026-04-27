import {
  Stack,
  StackProps,
  Tags,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ce from 'aws-cdk-lib/aws-ce';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface ObservabilityStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly cluster: ecs.ICluster;
  readonly webService: ecs.FargateService;
  readonly apiService: ecs.FargateService;
  readonly alb: elbv2.IApplicationLoadBalancer;
  readonly monthlyBudgetUsd?: number;
  readonly alarmEmail?: string;
}

export class ObservabilityStack extends Stack {
  public readonly alarmTopic: sns.ITopic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const {
      projectName, envName, cluster, webService, apiService, alb,
      monthlyBudgetUsd = 1000, alarmEmail,
    } = props;
    const namePrefix = `${projectName}-${envName}`;
    const customNamespace = 'OntologyRetail/Demo';
    const customDims = { Environment: envName };

    // -------------------------------------------------------------------
    // 1. SNS topic for alarms (Slack subscription is added manually post-deploy)
    // -------------------------------------------------------------------
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${namePrefix}-alarms`,
      displayName: 'Ontology Demo Alarms',
    });
    if (alarmEmail) {
      new sns.Subscription(this, 'AlarmEmailSub', {
        topic: this.alarmTopic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: alarmEmail,
      });
    }
    // Allow AWS Budgets service to publish to alarm topic (CfnBudget SNS subs).
    this.alarmTopic.grantPublish(new iam.ServicePrincipal('budgets.amazonaws.com'));

    // -------------------------------------------------------------------
    // 2. Custom metric definitions (PutMetricData written by app code)
    // -------------------------------------------------------------------
    const customMetric = (metricName: string, statistic = 'Average'): cloudwatch.Metric =>
      new cloudwatch.Metric({
        namespace: customNamespace, metricName, statistic,
        period: Duration.minutes(5), dimensionsMap: customDims,
      });

    const searchP50 = customMetric('Search.Latency.p50');
    const searchP95 = customMetric('Search.Latency.p95');
    const searchP99 = customMetric('Search.Latency.p99');
    const agentToolCalls = customMetric('Agent.ToolCall.Count', 'Sum');
    const rerankerLatency = customMetric('Reranker.Latency');
    const rerankerCalls = customMetric('Reranker.Calls', 'Sum');
    const guardrailsRedacted = customMetric('Guardrails.PiiRedacted.Count', 'Sum');
    const bedrockTokensIn = customMetric('Bedrock.Tokens.Input', 'Sum');
    const bedrockTokensOut = customMetric('Bedrock.Tokens.Output', 'Sum');

    // -------------------------------------------------------------------
    // 3. Alarms (spec § 12.3)
    // -------------------------------------------------------------------
    const snsAction = new cwActions.SnsAction(this.alarmTopic);

    new cloudwatch.Alarm(this, 'SearchP95LatencyAlarm', {
      alarmName: `${namePrefix}-search-p95-latency`,
      alarmDescription: 'Search p95 latency above 3s threshold (spec § 1.2 SLO)',
      metric: searchP95,
      threshold: 3000,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, 'WebTaskHealthAlarm', {
      alarmName: `${namePrefix}-web-task-health`,
      alarmDescription: 'Web service running task count below desired (2)',
      metric: webService.metric('RunningTaskCount', { statistic: 'Minimum', period: Duration.minutes(1) }),
      threshold: 2,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, 'ApiTaskHealthAlarm', {
      alarmName: `${namePrefix}-api-task-health`,
      alarmDescription: 'API service running task count below desired (2)',
      metric: apiService.metric('RunningTaskCount', { statistic: 'Minimum', period: Duration.minutes(1) }),
      threshold: 2,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, 'Bedrock5xxRateAlarm', {
      alarmName: `${namePrefix}-bedrock-5xx-rate`,
      alarmDescription: 'Bedrock invocation server errors > 5% over 5min',
      metric: new cloudwatch.MathExpression({
        expression: '(errors / invocations) * 100',
        usingMetrics: {
          errors: new cloudwatch.Metric({
            namespace: 'AWS/Bedrock',
            metricName: 'InvocationServerErrors',
            statistic: 'Sum',
            period: Duration.minutes(5),
          }),
          invocations: new cloudwatch.Metric({
            namespace: 'AWS/Bedrock',
            metricName: 'Invocations',
            statistic: 'Sum',
            period: Duration.minutes(5),
          }),
        },
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, 'AlbTarget5xxAlarm', {
      alarmName: `${namePrefix}-alb-target-5xx`,
      alarmDescription: 'ALB target 5xx > 10/min',
      metric: alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
      threshold: 10,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    // -------------------------------------------------------------------
    // 4. CloudWatch Dashboard "Demo Health" (spec § 12.2)
    // -------------------------------------------------------------------
    this.dashboard = new cloudwatch.Dashboard(this, 'DemoHealthDashboard', {
      dashboardName: `${namePrefix}-demo-health`,
      defaultInterval: Duration.hours(3),
    });

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# ${namePrefix} — Demo Health\nPre-demo 5-minute checklist (spec § 12.2)`,
        width: 24, height: 1,
      }),
    );
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'A. Search Latency (ms)',
        left: [searchP50, searchP95, searchP99],
        width: 12, height: 6,
        leftAnnotations: [{ value: 3000, label: 'p95 SLO 3s', color: '#ff0000' }],
      }),
      new cloudwatch.GraphWidget({
        title: 'B. Agent Tool Calls + Reranker',
        left: [agentToolCalls, rerankerCalls],
        right: [rerankerLatency],
        width: 12, height: 6,
      }),
    );
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'C. Bedrock Tokens (Input vs Output)',
        left: [bedrockTokensIn],
        right: [bedrockTokensOut],
        width: 12, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'C2. Guardrails PII Redactions',
        left: [guardrailsRedacted],
        width: 12, height: 6,
      }),
    );
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'D. Fargate Task Counts',
        left: [
          webService.metric('RunningTaskCount', { statistic: 'Average', label: 'web running' }),
          apiService.metric('RunningTaskCount', { statistic: 'Average', label: 'api running' }),
        ],
        width: 12, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'D2. ALB Request + 5xx',
        left: [alb.metrics.requestCount({ statistic: 'Sum' })],
        right: [
          alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { statistic: 'Sum' }),
          alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_4XX_COUNT, { statistic: 'Sum' }),
        ],
        width: 12, height: 6,
      }),
    );
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'D3. ECS CPU/Memory Utilization',
        left: [
          webService.metricCpuUtilization({ label: 'web CPU' }),
          apiService.metricCpuUtilization({ label: 'api CPU' }),
        ],
        right: [
          webService.metricMemoryUtilization({ label: 'web Mem' }),
          apiService.metricMemoryUtilization({ label: 'api Mem' }),
        ],
        width: 24, height: 6,
      }),
    );

    // -------------------------------------------------------------------
    // 5. AWS Budgets — monthly threshold (spec § 11.2)
    // -------------------------------------------------------------------
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${namePrefix}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: [`user:Project$${projectName}`] },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alarmTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alarmTopic.topicArn }],
        },
      ],
    });

    // -------------------------------------------------------------------
    // 6. CloudTrail with Bedrock data events (spec § 10 audit)
    //    Captures InvokeModel / Retrieve calls — required for compliance
    //    audit trail of which IAM principal called which model when.
    // -------------------------------------------------------------------
    const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      bucketName: `${namePrefix}-cloudtrail-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const trail = new cloudtrail.Trail(this, 'BedrockTrail', {
      trailName: `${namePrefix}-bedrock`,
      bucket: trailBucket,
      includeGlobalServiceEvents: false,
      isMultiRegionTrail: false,
      sendToCloudWatchLogs: false,
    });
    // Bedrock data events must be configured via the L1 — Trail L2 doesn't
    // yet support arbitrary advanced event selectors.
    const cfnTrail = trail.node.defaultChild as cloudtrail.CfnTrail;
    cfnTrail.advancedEventSelectors = [
      {
        name: 'BedrockModelInvocations',
        fieldSelectors: [
          { field: 'eventCategory', equalTo: ['Data'] },
          { field: 'resources.type', equalTo: ['AWS::Bedrock::ModelInvocationLog'] },
        ],
      },
    ];

    // -------------------------------------------------------------------
    // 7. Cost Anomaly Detection (spec § 11.2)
    //    AWS allows only ONE DIMENSIONAL anomaly monitor per account, and
    //    the Default-Services-Monitor is auto-created. Look up its ARN via
    //    AwsCustomResource (account-portable; no hardcoded UUID).
    // -------------------------------------------------------------------
    const defaultMonitor = new cr.AwsCustomResource(this, 'DefaultMonitorLookup', {
      onUpdate: {
        service: 'CostExplorer',
        action: 'getAnomalyMonitors',
        parameters: { MaxResults: 10 },
        physicalResourceId: cr.PhysicalResourceId.of(`${namePrefix}-default-monitor`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['ce:GetAnomalyMonitors'],
          resources: ['*'],
        }),
      ]),
      installLatestAwsSdk: false,
    });
    const defaultMonitorArn = defaultMonitor.getResponseField('AnomalyMonitors.0.MonitorArn');
    new ce.CfnAnomalySubscription(this, 'CostAnomalySubscription', {
      subscriptionName: `${namePrefix}-cost-anomaly`,
      monitorArnList: [defaultMonitorArn],
      frequency: 'IMMEDIATE',
      threshold: 50,
      subscribers: [{ type: 'SNS', address: this.alarmTopic.topicArn }],
    });
    this.alarmTopic.grantPublish(new iam.ServicePrincipal('costalerts.amazonaws.com'));

    // -------------------------------------------------------------------
    // 8. Tags
    // -------------------------------------------------------------------
    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'observability');
    Tags.of(this).add('ManagedBy', 'cdk');
  }
}
