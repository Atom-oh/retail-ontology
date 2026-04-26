#!/usr/bin/env node
import 'source-map-support/register';
import { App, Tags } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { AiStack } from '../lib/ai-stack';
import { ComputeStack } from '../lib/compute-stack';
import { EdgeStack } from '../lib/edge-stack';
import { ObservabilityStack } from '../lib/observability-stack';

const app = new App();

const projectName = app.node.tryGetContext('ontology:projectName') as string;
const envName = app.node.tryGetContext('ontology:env') as string;
const primaryRegion = app.node.tryGetContext('ontology:primaryRegion') as string;
const edgeRegion = app.node.tryGetContext('ontology:edgeRegion') as string;
const vpcCidr = app.node.tryGetContext('ontology:vpcCidr') as string;
const maxAzs = app.node.tryGetContext('ontology:maxAzs') as number;
const natGateways = app.node.tryGetContext('ontology:natGateways') as number;

if (!projectName || !envName || !primaryRegion || !edgeRegion || !vpcCidr) {
  throw new Error(
    'Missing required context: ontology:{projectName,env,primaryRegion,edgeRegion,vpcCidr}. ' +
      'Check infra-cdk/cdk.json or pass via -c flag.',
  );
}

const account = process.env.CDK_DEFAULT_ACCOUNT;
const primaryEnv = { account, region: primaryRegion };
const edgeEnv = { account, region: edgeRegion };

const stackPrefix = projectName
  .split('-')
  .map((p) => p[0].toUpperCase() + p.slice(1))
  .join('');

const baseProps = { projectName, envName };

const network = new NetworkStack(app, `${stackPrefix}Network`, {
  ...baseProps,
  env: primaryEnv,
  vpcCidr,
  maxAzs,
  natGateways,
  description: 'VPC, subnets, NAT, security groups, VPC endpoints',
});

const data = new DataStack(app, `${stackPrefix}Data`, {
  ...baseProps,
  env: primaryEnv,
  vpc: network.vpc,
  auroraSg: network.auroraSg,
  neptuneSg: network.neptuneSg,
  vpceSg: network.vpceSg,
  description: 'Neptune, Aurora, OpenSearch Serverless, S3, KMS',
});
data.addDependency(network);

const ai = new AiStack(app, `${stackPrefix}Ai`, {
  ...baseProps,
  env: primaryEnv,
  rawDocsBucket: data.rawDocsBucket,
  openSearchCollection: data.openSearchCollection,
  openSearchKey: data.openSearchKey,
  description: 'Bedrock Knowledge Bases, Guardrails, AgentCore Memory',
});
ai.addDependency(data);

const compute = new ComputeStack(app, `${stackPrefix}Compute`, {
  ...baseProps,
  env: primaryEnv,
  vpc: network.vpc,
  albSg: network.albSg,
  webSg: network.webSg,
  apiSg: network.apiSg,
  auroraSecret: data.auroraSecret,
  neptuneCluster: data.neptuneCluster,
  openSearchCollection: data.openSearchCollection,
  knowledgeBaseId: ai.knowledgeBaseId,
  guardrailId: ai.guardrailId,
  guardrailVersion: ai.guardrailVersion,
  agentCoreMemoryId: ai.agentCoreMemoryId,
  logsKey: data.logsKey,
  rawDocsBucket: data.rawDocsBucket,
  uploadsBucket: data.uploadsBucket,
  description: 'ECS Cluster, ECR, ALB, Fargate web/api services',
});
compute.addDependency(network);
compute.addDependency(data);
compute.addDependency(ai);

const edge = new EdgeStack(app, `${stackPrefix}Edge`, {
  ...baseProps,
  env: primaryEnv,
  edgeEnv,
  description: 'CloudFront, Cognito, Lambda@Edge (cross-region us-east-1), WAF',
  crossRegionReferences: true,
});
edge.addDependency(compute);

const observability = new ObservabilityStack(app, `${stackPrefix}Observability`, {
  ...baseProps,
  env: primaryEnv,
  description: 'CloudWatch Dashboard, Alarms, AWS Budgets',
});
observability.addDependency(compute);
observability.addDependency(data);
observability.addDependency(ai);

Tags.of(app).add('Project', projectName);
Tags.of(app).add('Environment', envName);
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Repo', 'ontology-for-retail');

app.synth();
