import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface DataStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly vpc: ec2.IVpc;
  readonly auroraSg: ec2.ISecurityGroup;
  readonly neptuneSg: ec2.ISecurityGroup;
  readonly vpceSg: ec2.ISecurityGroup;
}

export class DataStack extends Stack {
  // TODO Phase 2 outputs (consumed by AiStack / ComputeStack):
  //   public readonly auroraSecret: secretsmanager.ISecret;
  //   public readonly neptuneClusterEndpoint: string;
  //   public readonly openSearchCollectionEndpoint: string;
  //   public readonly rawDocsBucket: s3.IBucket;
  //   public readonly syntheticDataBucket: s3.IBucket;
  //   public readonly ontologySnapshotsBucket: s3.IBucket;
  //   public readonly uploadsBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { projectName, envName } = props;

    // TODO Phase 2 — Data layer (spec § 6.3):
    //
    // 1. KMS CMKs × 5 (s3, aurora, neptune, opensearch, logs)
    //    - enableKeyRotation: true
    //    - removalPolicy: RemovalPolicy.DESTROY for envName=dev, RETAIN for prod
    //    - alias: `${projectName}-${envName}-{purpose}`
    //
    // 2. S3 buckets (kms-encrypted, block all public, versioning where applicable)
    //    - raw-docs       : KB source documents (PDF/MD/HTML)
    //    - synthetic-data : generated SKU/review/persona JSON
    //    - ontology-snapshots : Neptune backup snapshots
    //    - uploads        : MD insight PDFs from scenario C
    //
    // 3. Neptune Serverless cluster (spec § 6.3):
    //    - NCU min 1, max 8
    //    - engine: Gremlin + SPARQL
    //    - IAM database authentication enabled
    //    - subnetGroup: vpc PRIVATE_WITH_EGRESS subnets
    //    - securityGroups: [neptuneSg]
    //    - storageEncrypted: true (KMS)
    //    - backupRetention: 1 day for dev
    //
    // 4. Aurora PostgreSQL Serverless v2 (spec § 6.3):
    //    - engineVersion: PostgreSQL 15.x
    //    - serverlessV2MinCapacity: 0.5, max: 2
    //    - credentials: from Secrets Manager (auto-generated)
    //    - storageEncrypted: true (KMS)
    //    - subnetGroup: vpc PRIVATE_WITH_EGRESS subnets
    //    - securityGroups: [auroraSg]
    //    - backupRetention: 1 day for dev
    //
    // 5. OpenSearch Serverless collection (spec § 6.3):
    //    - type: VECTORSEARCH (KB vector backend) + indices for Nori BM25
    //    - 2 OCU min (1 indexing + 1 search)
    //    - encryption policy with KMS
    //    - network policy: VPC endpoints to vpceSg, no public access
    //    - data access policy: API task role + bedrock-kb-role write
    //    - Nori analyzer config via index template (post-deploy script)

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'data');
    Tags.of(this).add('ManagedBy', 'cdk');
  }
}
