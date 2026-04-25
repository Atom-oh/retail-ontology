import {
  Stack,
  StackProps,
  RemovalPolicy,
  Tags,
  CfnOutput,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as neptune from 'aws-cdk-lib/aws-neptune';
import * as oss from 'aws-cdk-lib/aws-opensearchserverless';

export interface DataStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly vpc: ec2.IVpc;
  readonly auroraSg: ec2.ISecurityGroup;
  readonly neptuneSg: ec2.ISecurityGroup;
  readonly vpceSg: ec2.ISecurityGroup;
}

export class DataStack extends Stack {
  public readonly s3Key: kms.IKey;
  public readonly auroraKey: kms.IKey;
  public readonly neptuneKey: kms.IKey;
  public readonly openSearchKey: kms.IKey;
  public readonly logsKey: kms.IKey;

  public readonly rawDocsBucket: s3.IBucket;
  public readonly syntheticDataBucket: s3.IBucket;
  public readonly ontologySnapshotsBucket: s3.IBucket;
  public readonly uploadsBucket: s3.IBucket;

  public readonly auroraCluster: rds.IDatabaseCluster;
  public readonly auroraSecret: secretsmanager.ISecret;

  public readonly neptuneCluster: neptune.CfnDBCluster;

  public readonly openSearchCollection: oss.CfnCollection;
  public readonly openSearchVpcEndpoint: oss.CfnVpcEndpoint;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { projectName, envName, vpc, auroraSg, neptuneSg, vpceSg } = props;
    const isProd = envName === 'prod';
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const namePrefix = `${projectName}-${envName}`;

    // -------------------------------------------------------------------
    // 1. KMS Customer Managed Keys × 5
    //    Separate keys per data domain so blast radius of key rotation /
    //    key compromise is limited per service (defense in depth).
    // -------------------------------------------------------------------
    const makeKey = (id: string, purpose: string): kms.Key =>
      new kms.Key(this, id, {
        description: `${namePrefix} ${purpose} encryption`,
        alias: `alias/${namePrefix}-${purpose}`,
        enableKeyRotation: true,
        removalPolicy,
        pendingWindow: Duration.days(7),
      });

    this.s3Key = makeKey('S3Key', 's3');
    this.auroraKey = makeKey('AuroraKey', 'aurora');
    this.neptuneKey = makeKey('NeptuneKey', 'neptune');
    this.openSearchKey = makeKey('OpenSearchKey', 'opensearch');
    this.logsKey = makeKey('LogsKey', 'logs');

    // -------------------------------------------------------------------
    // 2. S3 Buckets × 4 (KMS, block public, versioning where needed)
    // -------------------------------------------------------------------
    const makeBucket = (id: string, suffix: string, opts: {
      versioned?: boolean;
      lifecycleIaDays?: number;
    } = {}): s3.IBucket =>
      new s3.Bucket(this, id, {
        bucketName: `${namePrefix}-${suffix}-${this.account}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: this.s3Key,
        enforceSSL: true,
        versioned: opts.versioned ?? false,
        removalPolicy,
        autoDeleteObjects: !isProd,
        lifecycleRules: [
          {
            abortIncompleteMultipartUploadAfter: Duration.days(7),
            ...(opts.lifecycleIaDays
              ? {
                  transitions: [
                    {
                      storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                      transitionAfter: Duration.days(opts.lifecycleIaDays),
                    },
                  ],
                }
              : {}),
          },
        ],
      });

    this.rawDocsBucket = makeBucket('RawDocsBucket', 'raw-docs', {
      versioned: true,
      lifecycleIaDays: 60,
    });
    this.syntheticDataBucket = makeBucket('SyntheticDataBucket', 'synthetic-data', {});
    this.ontologySnapshotsBucket = makeBucket('OntologySnapshotsBucket', 'ontology-snapshots', {
      versioned: true,
      lifecycleIaDays: 30,
    });
    this.uploadsBucket = makeBucket('UploadsBucket', 'uploads', { lifecycleIaDays: 30 });

    // -------------------------------------------------------------------
    // 3. Aurora PostgreSQL Serverless v2 (spec § 6.3, ACU 0.5–2)
    // -------------------------------------------------------------------
    const auroraSecret = new secretsmanager.Secret(this, 'AuroraSecret', {
      secretName: `${namePrefix}-aurora-credentials`,
      description: 'Aurora PostgreSQL master credentials',
      encryptionKey: this.auroraKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'app_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
      removalPolicy,
    });
    this.auroraSecret = auroraSecret;

    this.auroraCluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      clusterIdentifier: `${namePrefix}-aurora`,
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of('15.5', '15'),
      }),
      credentials: rds.Credentials.fromSecret(auroraSecret),
      defaultDatabaseName: 'ontology',
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [auroraSg],
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
      }),
      storageEncrypted: true,
      storageEncryptionKey: this.auroraKey,
      backup: { retention: Duration.days(isProd ? 7 : 1) },
      deletionProtection: isProd,
      iamAuthentication: true,
      removalPolicy,
    });

    // -------------------------------------------------------------------
    // 4. Neptune Serverless (spec § 6.3, NCU 1–8)
    //    L1 constructs because aws-cdk-lib/aws-neptune L2 lacks serverless
    //    scaling configuration as of 2.150.
    // -------------------------------------------------------------------
    const neptuneSubnetGroup = new neptune.CfnDBSubnetGroup(this, 'NeptuneSubnetGroup', {
      dbSubnetGroupName: `${namePrefix}-neptune-subnets`,
      dbSubnetGroupDescription: 'Neptune private subnets',
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
    });

    this.neptuneCluster = new neptune.CfnDBCluster(this, 'NeptuneCluster', {
      dbClusterIdentifier: `${namePrefix}-neptune`,
      engineVersion: '1.3.2.0',
      dbSubnetGroupName: neptuneSubnetGroup.ref,
      vpcSecurityGroupIds: [neptuneSg.securityGroupId],
      storageEncrypted: true,
      kmsKeyId: this.neptuneKey.keyArn,
      iamAuthEnabled: true,
      backupRetentionPeriod: isProd ? 7 : 1,
      deletionProtection: isProd,
      serverlessScalingConfiguration: {
        minCapacity: 1.0,
        maxCapacity: 8.0,
      },
    });
    this.neptuneCluster.addDependency(neptuneSubnetGroup);
    this.neptuneCluster.applyRemovalPolicy(removalPolicy);

    const neptuneInstance = new neptune.CfnDBInstance(this, 'NeptuneInstance', {
      dbInstanceIdentifier: `${namePrefix}-neptune-1`,
      dbInstanceClass: 'db.serverless',
      dbClusterIdentifier: this.neptuneCluster.ref,
    });
    neptuneInstance.addDependency(this.neptuneCluster);
    neptuneInstance.applyRemovalPolicy(removalPolicy);

    // -------------------------------------------------------------------
    // 5. OpenSearch Serverless (spec § 6.3, VECTORSEARCH + Nori)
    //    3 policies (encryption / network / data) + VPC endpoint + collection.
    //    standbyReplicas DISABLED in dev to halve OCU cost.
    // -------------------------------------------------------------------
    const collectionName = `${namePrefix}-os`;

    this.openSearchVpcEndpoint = new oss.CfnVpcEndpoint(this, 'OpenSearchVpcEndpoint', {
      name: `${namePrefix}-os-vpce`,
      vpcId: vpc.vpcId,
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroupIds: [vpceSg.securityGroupId],
    });

    const encryptionPolicy = new oss.CfnSecurityPolicy(this, 'OpenSearchEncryptionPolicy', {
      name: `${namePrefix}-os-enc`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{ ResourceType: 'collection', Resource: [`collection/${collectionName}`] }],
        AWSOwnedKey: false,
        KmsARN: this.openSearchKey.keyArn,
      }),
    });

    const networkPolicy = new oss.CfnSecurityPolicy(this, 'OpenSearchNetworkPolicy', {
      name: `${namePrefix}-os-net`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            { ResourceType: 'collection', Resource: [`collection/${collectionName}`] },
            { ResourceType: 'dashboard', Resource: [`collection/${collectionName}`] },
          ],
          AllowFromPublic: false,
          SourceVPCEs: [this.openSearchVpcEndpoint.attrId],
        },
      ]),
    });

    this.openSearchCollection = new oss.CfnCollection(this, 'OpenSearchCollection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      description: 'Ontology demo: hybrid (vector + Nori BM25) search',
      standbyReplicas: 'DISABLED',
    });
    this.openSearchCollection.addDependency(encryptionPolicy);
    this.openSearchCollection.addDependency(networkPolicy);
    this.openSearchCollection.applyRemovalPolicy(removalPolicy);

    // Base data access policy — grants account principals admin on the collection.
    // Compute / Ai stacks should add fine-grained CfnAccessPolicy resources for
    // ECS task role + Bedrock KB role specifically.
    new oss.CfnAccessPolicy(this, 'OpenSearchBaseDataPolicy', {
      name: `${namePrefix}-os-data-base`,
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:CreateCollectionItems',
                'aoss:DeleteCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems',
              ],
            },
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:DeleteIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument',
              ],
            },
          ],
          Principal: [`arn:aws:iam::${this.account}:root`],
        },
      ]),
    });

    // -------------------------------------------------------------------
    // 6. Tags + Outputs
    // -------------------------------------------------------------------
    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'data');
    Tags.of(this).add('ManagedBy', 'cdk');

    new CfnOutput(this, 'AuroraSecretArn', {
      value: this.auroraSecret.secretArn,
      exportName: `${namePrefix}-aurora-secret-arn`,
    });
    new CfnOutput(this, 'AuroraClusterEndpoint', {
      value: this.auroraCluster.clusterEndpoint.hostname,
    });
    new CfnOutput(this, 'NeptuneClusterEndpoint', {
      value: this.neptuneCluster.attrEndpoint,
      exportName: `${namePrefix}-neptune-endpoint`,
    });
    new CfnOutput(this, 'NeptuneClusterReadEndpoint', {
      value: this.neptuneCluster.attrReadEndpoint,
    });
    new CfnOutput(this, 'OpenSearchCollectionEndpoint', {
      value: this.openSearchCollection.attrCollectionEndpoint,
      exportName: `${namePrefix}-opensearch-endpoint`,
    });
    new CfnOutput(this, 'RawDocsBucketName', {
      value: this.rawDocsBucket.bucketName,
      exportName: `${namePrefix}-raw-docs-bucket`,
    });
    new CfnOutput(this, 'UploadsBucketName', { value: this.uploadsBucket.bucketName });
    new CfnOutput(this, 'OntologySnapshotsBucketName', {
      value: this.ontologySnapshotsBucket.bucketName,
    });
  }
}
