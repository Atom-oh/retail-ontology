/**
 * CDK snapshot tests for all six Ontology Retail stacks.
 *
 * Synthesizes the same stack graph as bin/app.ts but with deterministic test
 * context so snapshots are stable across machines. First run generates the
 * .snap files under __snapshots__/; subsequent runs compare and fail on drift.
 *
 * Update workflow: run `npx jest -u` after intentional infrastructure changes
 * and review the snapshot diff in the PR.
 */
import { App, Tags } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { AiStack } from '../lib/ai-stack';
import { ComputeStack } from '../lib/compute-stack';
import { EdgeStack } from '../lib/edge-stack';
import { ObservabilityStack } from '../lib/observability-stack';

describe('CDK stack synthesis', () => {
  const projectName = 'ontology-retail';
  const envName = 'test';
  const primaryRegion = 'ap-northeast-2';
  const edgeRegion = 'us-east-1';
  const account = '000000000000';
  const primaryEnv = { account, region: primaryRegion };
  const edgeEnv = { account, region: edgeRegion };
  const stackPrefix = 'OntologyRetail';
  const baseProps = { projectName, envName };

  let network: NetworkStack;
  let data: DataStack;
  let ai: AiStack;
  let compute: ComputeStack;
  let edge: EdgeStack;
  let observability: ObservabilityStack;

  beforeAll(() => {
    const app = new App();

    network = new NetworkStack(app, `${stackPrefix}Network`, {
      ...baseProps,
      env: primaryEnv,
      vpcCidr: '10.20.0.0/16',
      maxAzs: 2,
      natGateways: 1,
      // No importVpcId — fresh VPC for snapshot determinism
    });

    data = new DataStack(app, `${stackPrefix}Data`, {
      ...baseProps,
      env: primaryEnv,
      vpc: network.vpc,
      auroraSg: network.auroraSg,
      neptuneSg: network.neptuneSg,
      vpceSg: network.vpceSg,
    });
    data.addDependency(network);

    ai = new AiStack(app, `${stackPrefix}Ai`, {
      ...baseProps,
      env: primaryEnv,
      rawDocsBucket: data.rawDocsBucket,
      openSearchCollection: data.openSearchCollection,
      openSearchKey: data.openSearchKey,
      s3Key: data.s3Key,
    });
    ai.addDependency(data);

    compute = new ComputeStack(app, `${stackPrefix}Compute`, {
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
      agentCoreMemoryParameterName: ai.agentCoreMemoryParameterName,
      s3Key: data.s3Key,
      auroraKey: data.auroraKey,
      logsKey: data.logsKey,
      rawDocsBucket: data.rawDocsBucket,
      uploadsBucket: data.uploadsBucket,
      syntheticDataBucket: data.syntheticDataBucket,
      originAuthSecret: data.originAuthSecret,
    });
    compute.addDependency(network);
    compute.addDependency(data);
    compute.addDependency(ai);

    edge = new EdgeStack(app, `${stackPrefix}Edge`, {
      ...baseProps,
      env: primaryEnv,
      edgeEnv,
      alb: compute.alb,
      originAuthSecret: data.originAuthSecret,
      crossRegionReferences: true,
    });
    edge.addDependency(compute);

    observability = new ObservabilityStack(app, `${stackPrefix}Observability`, {
      ...baseProps,
      env: primaryEnv,
      cluster: compute.cluster,
      webService: compute.webService,
      apiService: compute.apiService,
      alb: compute.alb,
      monthlyBudgetUsd: 1000,
    });
    observability.addDependency(compute);
    observability.addDependency(data);
    observability.addDependency(ai);

    Tags.of(app).add('Project', projectName);
    Tags.of(app).add('Environment', envName);
    Tags.of(app).add('ManagedBy', 'cdk');
    Tags.of(app).add('Repo', 'ontology-for-retail');
  });

  test('NetworkStack synthesizes', () => {
    const t = Template.fromStack(network);
    // Sanity asserts — fail fast with readable errors before snapshot mismatch
    t.resourceCountIs('AWS::EC2::VPC', 1);
    expect(t.toJSON()).toMatchSnapshot();
  });

  test('DataStack synthesizes', () => {
    const t = Template.fromStack(data);
    expect(t.toJSON()).toMatchSnapshot();
  });

  test('AiStack synthesizes', () => {
    const t = Template.fromStack(ai);
    expect(t.toJSON()).toMatchSnapshot();
  });

  test('ComputeStack synthesizes', () => {
    const t = Template.fromStack(compute);
    t.resourceCountIs('AWS::ECS::Cluster', 1);
    expect(t.toJSON()).toMatchSnapshot();
  });

  test('EdgeStack synthesizes', () => {
    const t = Template.fromStack(edge);
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
    expect(t.toJSON()).toMatchSnapshot();
  });

  test('ObservabilityStack synthesizes', () => {
    const t = Template.fromStack(observability);
    expect(t.toJSON()).toMatchSnapshot();
  });
});
