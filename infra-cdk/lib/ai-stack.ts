import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AiStackProps extends StackProps {
  readonly projectName: string;
  readonly envName: string;
  // TODO Phase 2: wire from DataStack
  //   readonly rawDocsBucket: s3.IBucket;
  //   readonly openSearchCollectionEndpoint: string;
  //   readonly openSearchKmsKey: kms.IKey;
}

export class AiStack extends Stack {
  // TODO Phase 2 outputs (consumed by ComputeStack as env vars):
  //   public readonly knowledgeBaseId: string;
  //   public readonly guardrailId: string;
  //   public readonly guardrailVersion: string;
  //   public readonly agentCoreMemoryId: string;

  constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);

    const { projectName, envName } = props;

    // TODO Phase 2 — AI layer (spec § 6.4):
    //
    // 1. IAM role: bedrock-kb-role
    //    - assumed by bedrock.amazonaws.com
    //    - permissions: s3:Get* on raw-docs bucket, opensearch write on collection
    //    - bedrock:InvokeModel on Cohere Embed Multilingual v3
    //
    // 2. Bedrock Knowledge Base (vector RAG):
    //    - dataSource: S3 raw-docs (chunking: fixed 512 tokens, overlap 64)
    //    - embeddingModel: cohere.embed-multilingual-v3
    //    - vectorStore: OpenSearch Serverless (from DataStack)
    //    - role: bedrock-kb-role
    //
    // 3. Bedrock Guardrails (spec § 10):
    //    - sensitive information policies: Korean RRN, phone, address, name
    //    - content policies: prompt attack, hate, sexual, insults, violence, misconduct
    //    - topic policies (denied):
    //         - 임산부에 알코올/카페인 권유
    //         - 미성년에 성인 콘텐츠
    //         - 경쟁 브랜드 비방
    //    - blocked input/output messaging in Korean
    //
    // 4. AgentCore Memory (spec § 6.4):
    //    - session memory: short-term (per session)
    //    - long-term memory: 7-day retention, user-keyed
    //    - via aws-cdk-bedrock-agentcore L1 constructs or AwsCustomResource
    //      (depending on aws-cdk-lib version availability)
    //
    // 5. Cross-Region Inference Profile reference for Reranker (spec § 10.2):
    //    - InferenceProfileArn for cohere.rerank-v3 (us-east-1/us-west-2 backend)
    //    - exposed as env var BEDROCK_RERANKER_INFERENCE_PROFILE_ARN

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Environment', envName);
    Tags.of(this).add('Stack', 'ai');
    Tags.of(this).add('ManagedBy', 'cdk');
  }
}
