import { Stack, StackProps, Tags, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cr from 'aws-cdk-lib/custom-resources';

export interface NetworkStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly vpcCidr: string;
  readonly maxAzs: number;
  readonly natGateways: number;
}

export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSg: ec2.SecurityGroup;
  public readonly webSg: ec2.SecurityGroup;
  public readonly apiSg: ec2.SecurityGroup;
  public readonly auroraSg: ec2.SecurityGroup;
  public readonly neptuneSg: ec2.SecurityGroup;
  public readonly vpceSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { projectName, envName, vpcCidr, maxAzs, natGateways } = props;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
      maxAzs,
      natGateways,
      vpcName: `${projectName}-${envName}-vpc`,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: false,
        },
        {
          name: 'private-egress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    this.albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      securityGroupName: `${projectName}-${envName}-alb-sg`,
      description: 'ALB ingress from CloudFront only',
      allowAllOutbound: true,
    });

    this.webSg = new ec2.SecurityGroup(this, 'WebSg', {
      vpc: this.vpc,
      securityGroupName: `${projectName}-${envName}-web-sg`,
      description: 'Next.js Fargate task',
      allowAllOutbound: true,
    });

    this.apiSg = new ec2.SecurityGroup(this, 'ApiSg', {
      vpc: this.vpc,
      securityGroupName: `${projectName}-${envName}-api-sg`,
      description: 'FastAPI Fargate task',
      allowAllOutbound: true,
    });

    this.auroraSg = new ec2.SecurityGroup(this, 'AuroraSg', {
      vpc: this.vpc,
      securityGroupName: `${projectName}-${envName}-aurora-sg`,
      description: 'Aurora PostgreSQL Serverless v2',
      allowAllOutbound: false,
    });

    this.neptuneSg = new ec2.SecurityGroup(this, 'NeptuneSg', {
      vpc: this.vpc,
      securityGroupName: `${projectName}-${envName}-neptune-sg`,
      description: 'Neptune Serverless cluster',
      allowAllOutbound: false,
    });

    this.vpceSg = new ec2.SecurityGroup(this, 'VpceSg', {
      vpc: this.vpc,
      securityGroupName: `${projectName}-${envName}-vpce-sg`,
      description: 'Interface VPC Endpoints',
      allowAllOutbound: false,
    });

    const cfOriginPrefixListLookup = new cr.AwsCustomResource(this, 'CFOriginPrefixListLookup', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: {
          Filters: [
            {
              Name: 'prefix-list-name',
              Values: ['com.amazonaws.global.cloudfront.origin-facing'],
            },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${projectName}-cf-origin-pl-${this.region}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false,
    });
    const cfOriginPrefixListId = cfOriginPrefixListLookup.getResponseField('PrefixLists.0.PrefixListId');

    this.albSg.addIngressRule(
      ec2.Peer.prefixList(cfOriginPrefixListId),
      ec2.Port.tcp(80),
      'CloudFront origin-facing prefix list to ALB:80',
    );

    this.webSg.addIngressRule(
      ec2.Peer.securityGroupId(this.albSg.securityGroupId),
      ec2.Port.tcp(3000),
      'ALB to Next.js:3000',
    );

    this.apiSg.addIngressRule(
      ec2.Peer.securityGroupId(this.albSg.securityGroupId),
      ec2.Port.tcp(8000),
      'ALB to FastAPI:8000',
    );

    this.auroraSg.addIngressRule(
      ec2.Peer.securityGroupId(this.apiSg.securityGroupId),
      ec2.Port.tcp(5432),
      'API to Aurora PostgreSQL:5432',
    );

    this.neptuneSg.addIngressRule(
      ec2.Peer.securityGroupId(this.apiSg.securityGroupId),
      ec2.Port.tcp(8182),
      'API to Neptune Gremlin/SPARQL:8182',
    );

    this.vpceSg.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'VPC CIDR to Interface VPC Endpoints:443',
    );

    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    const interfaceEndpoints: { id: string; service: ec2.InterfaceVpcEndpointAwsService }[] = [
      { id: 'EcrApiEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR },
      { id: 'EcrDkrEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
      { id: 'CloudWatchLogsEndpoint', service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { id: 'SecretsManagerEndpoint', service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { id: 'BedrockRuntimeEndpoint', service: new ec2.InterfaceVpcEndpointAwsService('bedrock-runtime') },
    ];

    for (const { id, service } of interfaceEndpoints) {
      this.vpc.addInterfaceEndpoint(id, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.vpceSg],
        privateDnsEnabled: true,
      });
    }

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'network');
    Tags.of(this).add('ManagedBy', 'cdk');

    new CfnOutput(this, 'VpcId', { value: this.vpc.vpcId, exportName: `${projectName}-${envName}-vpc-id` });
    new CfnOutput(this, 'VpcCidr', { value: this.vpc.vpcCidrBlock });
    new CfnOutput(this, 'AlbSgId', { value: this.albSg.securityGroupId });
    new CfnOutput(this, 'ApiSgId', { value: this.apiSg.securityGroupId });
    new CfnOutput(this, 'CFOriginPrefixListId', { value: cfOriginPrefixListId });
  }
}
