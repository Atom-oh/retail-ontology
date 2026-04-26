import {
  Stack,
  StackProps,
  Tags,
  CfnOutput,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as oss from 'aws-cdk-lib/aws-opensearchserverless';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cr from 'aws-cdk-lib/custom-resources';

export interface AiStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  readonly rawDocsBucket: s3.IBucket;
  readonly openSearchCollection: oss.CfnCollection;
  readonly openSearchKey: kms.IKey;
  readonly s3Key: kms.IKey;
}

export class AiStack extends Stack {
  public readonly kbRole: iam.IRole;
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly kbVectorIndexName: string;
  public readonly guardrailId: string;
  public readonly guardrailVersion: string;
  public readonly agentCoreMemoryId: string;

  constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);

    const { projectName, envName, rawDocsBucket, openSearchCollection, openSearchKey, s3Key } = props;
    const namePrefix = `${projectName}-${envName}`;
    const collectionName = `${namePrefix}-os`;
    const indexName = `${namePrefix}-kb-index`;
    this.kbVectorIndexName = indexName;

    // -------------------------------------------------------------------
    // 1. KB IAM role (trust = bedrock.amazonaws.com, scoped via SourceArn)
    // -------------------------------------------------------------------
    const kbRole = new iam.Role(this, 'KBRole', {
      roleName: `${namePrefix}-bedrock-kb-role`,
      description: 'Bedrock Knowledge Base service role',
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
          },
        },
      }),
    });
    // Cross-stack: explicit policy statements (no grantX) to avoid modifying
    // KMS / S3 resource policies in DataStack (would create cycle).
    kbRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'S3RawDocsRead',
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [rawDocsBucket.bucketArn, `${rawDocsBucket.bucketArn}/*`],
    }));
    kbRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'S3KmsDecrypt',
      actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
      resources: [s3Key.keyArn],
    }));
    kbRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'OpenSearchKmsDecrypt',
      actions: ['kms:Decrypt'],
      resources: [openSearchKey.keyArn],
    }));
    kbRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AossAccess',
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollection.attrArn],
    }));
    kbRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/cohere.embed-multilingual-v3`,
      ],
    }));
    this.kbRole = kbRole;

    // -------------------------------------------------------------------
    // 2. OS Serverless data access policy for KB role
    //    Additive to the base policy in DataStack (account-root admin).
    // -------------------------------------------------------------------
    const kbAccessPolicy = new oss.CfnAccessPolicy(this, 'OpenSearchKBDataPolicy', {
      name: `${namePrefix}-os-kb`,
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:DescribeCollectionItems',
                'aoss:CreateCollectionItems',
                'aoss:UpdateCollectionItems',
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
          Principal: [kbRole.roleArn],
        },
      ]),
    });

    // -------------------------------------------------------------------
    // 3. Bedrock Guardrails (spec § 10)
    //    Korean PII (RRN/phone) + content filters + topic policies
    // -------------------------------------------------------------------
    const guardrail = new bedrock.CfnGuardrail(this, 'Guardrail', {
      name: `${namePrefix}-guardrail`,
      description: '한국 PII + 콘텐츠 안전 + 도메인 토픽',
      blockedInputMessaging: '죄송합니다. 안전 정책에 따라 답변할 수 없습니다.',
      blockedOutputsMessaging: '안전 정책에 따라 응답을 제공하지 못합니다.',
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'MISCONDUCT', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
        ],
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: 'PHONE', action: 'ANONYMIZE' },
          { type: 'EMAIL', action: 'ANONYMIZE' },
          { type: 'ADDRESS', action: 'ANONYMIZE' },
          { type: 'NAME', action: 'ANONYMIZE' },
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
        ],
        regexesConfig: [
          {
            name: 'KoreanRRN',
            description: '주민등록번호 13자리',
            pattern: '\\d{6}-?[1-4]\\d{6}',
            action: 'BLOCK',
          },
          {
            name: 'KoreanMobile',
            description: '한국 휴대폰 번호',
            pattern: '01[016789]-?\\d{3,4}-?\\d{4}',
            action: 'ANONYMIZE',
          },
        ],
      },
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: 'PregnancyHarmfulRecommendation',
            type: 'DENY',
            definition: '임산부에게 알코올, 카페인, 레티놀 등 임신 중 회피 성분을 권유하는 내용',
            examples: [
              '임산부에게 적당한 와인은 있나요',
              '임신 중에 마실 수 있는 커피',
              '임산부도 쓸 수 있는 레티놀 추천',
            ],
          },
          {
            name: 'CompetitorDisparagement',
            type: 'DENY',
            definition: '경쟁 브랜드를 부정적으로 비교하거나 비방하는 내용',
            examples: ['브랜드 X는 효과 없어요', '경쟁사 제품의 단점'],
          },
          {
            name: 'MinorAdultContent',
            type: 'DENY',
            definition: '미성년자에게 성인용 제품(주류, 담배)을 권유하는 내용',
          },
        ],
      },
    });
    this.guardrailId = guardrail.attrGuardrailId;
    this.guardrailVersion = guardrail.attrVersion;

    // -------------------------------------------------------------------
    // 4. Bedrock Knowledge Base + S3 DataSource
    //    PRECONDITION: OpenSearch index `{namePrefix}-kb-index` must exist
    //    (run scripts/create_kb_index.py after deploying DataStack).
    //    KB creation will fail-fast if index is missing.
    // -------------------------------------------------------------------
    // AOSS data access policy propagation is eventually consistent (~60s).
    // Insert a sleep CR so KB creation doesn't race the policy.
    const policyPropagation = new cr.AwsCustomResource(this, 'KBAccessPolicySleep', {
      onCreate: {
        service: 'STS',
        action: 'getCallerIdentity',
        physicalResourceId: cr.PhysicalResourceId.of('kb-policy-sleep'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      // 90 second timeout effectively waits for policy propagation
      timeout: Duration.seconds(120),
    });
    policyPropagation.node.addDependency(kbAccessPolicy);

    const kb = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: `${namePrefix}-kb`,
      description: 'Ontology demo KB — products, reviews, manuals',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/cohere.embed-multilingual-v3`,
        },
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: openSearchCollection.attrArn,
          vectorIndexName: indexName,
          fieldMapping: {
            vectorField: 'bedrock-knowledge-base-default-vector',
            textField: 'AMAZON_BEDROCK_TEXT_CHUNK',
            metadataField: 'AMAZON_BEDROCK_METADATA',
          },
        },
      },
    });
    kb.addDependency(kbAccessPolicy);
    kb.node.addDependency(policyPropagation);
    this.knowledgeBaseId = kb.attrKnowledgeBaseId;
    this.knowledgeBaseArn = kb.attrKnowledgeBaseArn;

    new bedrock.CfnDataSource(this, 'KBDataSourceRawDocs', {
      knowledgeBaseId: kb.attrKnowledgeBaseId,
      name: `${namePrefix}-raw-docs`,
      description: 'KB source — products / reviews / manuals',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: rawDocsBucket.bucketArn,
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: {
            maxTokens: 512,
            overlapPercentage: 12,
          },
        },
      },
    });

    // -------------------------------------------------------------------
    // 5. AgentCore Memory (spec § 6.4) — verified against awslabs/agentcore-samples
    //    Two distinct gotchas vs. earlier guesses:
    //      • parameter is `namespaceTemplates` (raw API) not `namespaces`
    //      • managed strategies require `memoryExecutionRoleArn` for Bedrock invoke
    //    Namespace variables: `{actorId}` and `{sessionId}` (not `{userId}`).
    // -------------------------------------------------------------------
    const memoryExecutionRole = new iam.Role(this, 'MemoryExecutionRole', {
      roleName: `${namePrefix}-agentcore-memory-role`,
      description: 'AgentCore Memory invokes Bedrock model for extraction/summarization',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    });
    memoryExecutionRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'BedrockInvokeForMemory',
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
      ],
    }));

    const memory = new cr.AwsCustomResource(this, 'AgentCoreMemory', {
      onCreate: {
        service: 'BedrockAgentCoreControl',
        action: 'createMemory',
        parameters: {
          name: `${namePrefix}-memory`,
          description: 'Ontology demo conversational memory (session + 7d long-term)',
          eventExpiryDuration: 7,
          memoryExecutionRoleArn: memoryExecutionRole.roleArn,
          memoryStrategies: [
            {
              summaryMemoryStrategy: {
                name: 'session_summary',
                namespaceTemplates: ['session/{sessionId}'],
              },
            },
            {
              userPreferenceMemoryStrategy: {
                name: 'user_preferences',
                namespaceTemplates: ['user/{actorId}/preferences'],
              },
            },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('id'),
      },
      onDelete: {
        service: 'BedrockAgentCoreControl',
        action: 'deleteMemory',
        parameters: {
          memoryId: new cr.PhysicalResourceIdReference(),
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: true,
      timeout: Duration.minutes(5),
    });
    memory.node.addDependency(memoryExecutionRole);
    this.agentCoreMemoryId = memory.getResponseField('id');

    // -------------------------------------------------------------------
    // 6. Tags + Outputs
    // -------------------------------------------------------------------
    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'ai');
    Tags.of(this).add('ManagedBy', 'cdk');

    new CfnOutput(this, 'KBRoleArn', { value: kbRole.roleArn, exportName: `${namePrefix}-kb-role-arn` });
    new CfnOutput(this, 'KnowledgeBaseId', { value: this.knowledgeBaseId, exportName: `${namePrefix}-kb-id` });
    new CfnOutput(this, 'KBVectorIndexName', { value: indexName });
    new CfnOutput(this, 'GuardrailId', { value: this.guardrailId, exportName: `${namePrefix}-guardrail-id` });
    new CfnOutput(this, 'GuardrailVersion', { value: this.guardrailVersion });
    new CfnOutput(this, 'AgentCoreMemoryId', { value: this.agentCoreMemoryId, exportName: `${namePrefix}-memory-id` });
  }
}
