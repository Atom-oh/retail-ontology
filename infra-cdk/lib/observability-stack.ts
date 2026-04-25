import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  // TODO Phase 2: wire from upstream stacks
  //   readonly clusterName: string;
  //   readonly webServiceName: string;
  //   readonly apiServiceName: string;
  //   readonly albFullName: string;            // for ALB metrics namespace
  //   readonly auroraClusterIdentifier: string;
  //   readonly neptuneClusterIdentifier: string;
}

export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { projectName, envName } = props;

    // TODO Phase 2 — Observability (spec § 12):
    //
    // 1. Custom CloudWatch metrics namespace `OntologyRetail/Demo`:
    //    - Search.Latency.{p50,p95,p99}
    //    - Agent.ToolCall.Count   (dim: tool)
    //    - Reranker.Calls / Reranker.Latency
    //    - Guardrails.PiiRedacted.Count
    //    - Bedrock.Tokens.{Input,Output}
    //    - Cytoscape.Render.Duration
    //    (these are PutMetricData from app code; we register dashboard)
    //
    // 2. CloudWatch Dashboard "Demo Health" (spec § 12.2):
    //    - Section A — Search: p50/p95/p99 latency, error rate, query volume
    //    - Section B — Agent: tool call counts, memory hits, agent latency
    //    - Section C — Bedrock: token usage by model, throttle rate, 5xx rate
    //    - Section D — Infra: Fargate task health, ALB target health,
    //                          Aurora ACU usage, Neptune NCU usage,
    //                          OpenSearch OCU usage
    //    - Section E — Cost: estimated daily spend (Cost Explorer widget)
    //
    // 3. Alarms (spec § 12.3) → SNS topic → Slack webhook:
    //    - SearchP95Latency: > 3s for 2/3 datapoints (5min)
    //    - FargateTaskHealth: any service running tasks < desired (any 5min)
    //    - Bedrock5xxRate: > 5% for 5min
    //    - BudgetMonthly: > $1,000 (AWS Budgets, separate from CW)
    //
    // 4. AWS Budgets (spec § 11.2):
    //    - monthly $1,000 actual + 80% forecast → SNS Slack
    //    - Cost Anomaly Detection on Bedrock + Fargate dimensions
    //
    // 5. X-Ray service map enabled at task definition level
    //    (xray:Put* perms in api task role, observability-stack only sets sampling rules)

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'observability');
    Tags.of(this).add('ManagedBy', 'cdk');
  }
}
