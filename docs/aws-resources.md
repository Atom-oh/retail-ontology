# AWS 자원 상세 가이드

이 프로젝트가 사용 중인 AWS 자원 각각의 **역할 / 선택 이유 / 시나리오 매핑**을 담은 가이드. [docs/architecture.md](architecture.md)의 시스템 개요와 짝을 이룹니다 — architecture는 layer 간 관계, 이 문서는 layer 내부의 자원별 책임.

---

## 0. 전체 구성 한 눈에

- **계정**: `<account-id>` (production-track demo)
- **Primary 리전**: `ap-northeast-2` (Seoul) — 대부분 자원
- **Edge 리전**: `us-east-1` — Lambda@Edge + ACM 인증서 (CloudFront 요건)
- **CDK 스택 6개**: `Network → Data → Ai → Compute → Edge + Observability`
- **항상 켜진 baseline 비용**: ~770 USD/월 (Neptune이 가장 큼)

---

## 1. Edge & Auth — 사용자 진입 계층

### CloudFront Distribution (`<distribution-id>`)

브라우저가 가장 먼저 만나는 layer. 기능:

- **TLS 종단** — `*.whchoi.net` ACM 인증서로 HTTPS 처리, ALB로는 HTTP-80 forward (데모 트레이드오프, [SECURITY.md](../SECURITY.md)에 production 마이그레이션 계획)
- **Viewer + Origin caching** — 정적 자산은 edge에서, 동적 API는 pass-through
- **Origin lock-down** — `X-Origin-Auth-Token` (Secrets Manager 백킹) 커스텀 헤더를 ALB로 주입 → ALB는 이 헤더 + CF 관리 prefix list만 통과시킴 → ALB DNS를 직접 알아내도 우회 불가
- **커스텀 도메인**: `retail-ontology.whchoi.net`

### Lambda@Edge (`AuthEdgeFn`, us-east-1)

CloudFront viewer-request 트리거:

- **쿠키 기반 인증 게이트** — `id_token` 쿠키 없으면 Cognito Hosted UI로 302 리다이렉트
- **us-east-1 강제 배치** — Lambda@Edge 요건. CDK `experimental.EdgeFunction`이 CloudFront와 별도 sibling stack 생성
- **[ADR-0003](decisions/0003-lambda-edge-stable-id-hardcode-strategy.md)**: Cognito 식별자(user_pool_id, client_id, domain)를 inline 코드에 hardcode (Lambda@Edge가 SSM/Secrets 못 읽기 때문). drift detection은 CDK output(`UserPoolId`, `UserPoolClientId`, `UserPoolDomain`)이 매 deploy 시 노출

### Cognito User Pool (`<user-pool-id>`)

신원 발행·검증 layer:

- **OAuth 2.0 Authorization Code grant + Hosted UI**
- **RS256 JWT** — JWKS는 1시간 TTL 캐시 (키 회전 대응)
- **데모 사용자**: `demo / demo@whchoi.net`, 비밀번호 정책 8자 (production은 더 강하게)
- **App Client ID는 Lambda@Edge inline + API env 양쪽에서 사용** — ADR-0003이 Lambda@Edge 측 hardcode trade-off 명시 (API 측은 required env로 강제)
- **Cognito는 PUT semantics** — `update-user-pool-client`가 미지정 필드를 null로 clobber. 그래서 ALL Cognito 변경은 CDK only ([ADR-0004](decisions/0004-cognito-user-pool-client-cdk-driven.md))

### ACM Certificate

- **us-east-1 발급** (CloudFront 요건). Wildcard `*.whchoi.net`
- DNS 검증, 자동 갱신

### Route 53

- **Hosted Zone**: `whchoi.net` 위에 ALIAS 레코드로 `retail-ontology.whchoi.net` → CloudFront distribution
- 도메인 변경 시 4개 surface 정합성: DNS, CF alias, Cognito callback, API `PUBLIC_DOMAIN` env (auto-sync rule in [CLAUDE.md](../CLAUDE.md))

---

## 2. Compute — 애플리케이션 실행 계층

### ECS Cluster (`ontology-retail-dev-cluster`)

Fargate 모드, 2개 서비스 호스팅.

### ECS Service: API (`ontology-retail-dev-api`)

- **Fargate ARM64**, 2-replica
- **이미지**: 단일 ECR 이미지가 두 역할 — API 서버 OR command override로 일회성 데이터 로더 (단일 이미지 두 역할 트레이드오프)
- **uvicorn + FastAPI**, 14개 라우터 (scenarios A–H + objects + ontology + ops + auth + health + ingest)
- **Bedrock + Neptune + OpenSearch + AgentCore** 모두 호출
- **Pydantic Settings**가 startup에 모든 env 검증 — fail-fast

### ECS Service: Web (`ontology-retail-dev-web`)

- **Fargate ARM64**, 2-replica
- **Next.js 14 App Router standalone build**
- 시나리오 A–H + Knowledge Graph 객체 탐색기 + 운영 콘솔
- API와 같은 ALB 뒤, path-based routing (`/api/*` → API, 나머지 → Web)

### Application Load Balancer

- **HTTP-80 origin** (TLS는 CloudFront 종단)
- **Security Group**: AWS 관리 prefix list `com.amazonaws.global.cloudfront.origin-facing`만 허용 — 내 ALB DNS를 직접 알아내도 거부
- ALB Access Logs → S3 (30일 후 Glacier transition)

### ECR Repositories

- `ontology-retail-dev-api`, `ontology-retail-dev-web` 각 1개씩
- ARM64 manifest, **`:latest` + SHA-pinned tag** 동시 push (deterministic rollout 위해 task definition은 SHA pin)

> **왜 ARM64?** Graviton2/3 가격 대비 성능이 약 20–40% 우위. Python(uvicorn)과 Node.js(Next.js)는 둘 다 ARM 네이티브. 단점은 빌드 시 `--platform linux/arm64` 플래그를 잊으면 ECS가 거부하는 것 — 그래서 [CLAUDE.md](../CLAUDE.md)에 "ARM64 everywhere" 규칙이 있고 CI에서도 검증.

---

## 3. Data & Search — 지식그래프 + 하이브리드 검색

### Amazon Neptune (`ontology-retail-dev-neptune`)

**프로젝트의 핵심 차별점.** 그래프 DB.

- **단일 인스턴스 dev sizing** (`db.r6g.large` 등)
- **openCypher 엔드포인트** — Neo4j 호환 query
- **IAM SigV4 인증** — boto3 `neptunedata` 클라이언트 사용 (수동 SigV4 서명 안 됨 — 일찍 학습한 gotcha)
- **19개 노드 클래스**: Product, Ingredient, Concern, Trend, Brand, Category, Persona, Channel, Manufacturer, Review + 물류층 (Region, Warehouse, Carrier, Route, Shipment, Event, Inventory)
- **약 5,000 노드 / 10,000 엣지**
- **Private subnet 전용** — laptop에서 직접 접근 불가, ECS one-shot loader를 같은 SG에서 실행
- **모든 Cypher**: `parameters={...}` keyword arg로 전달 (포지셔널은 TypeError, 인젝션 방지). 자세한 규약은 [.claude/skills/cypher-conventions.md](../.claude/skills/cypher-conventions.md)

### OpenSearch Serverless (`<opensearch-collection-id>`)

하이브리드 검색의 BM25 + KNN layer.

- **Serverless 모드** — capacity 자동 관리, 인덱싱 시 OCU 사용
- **인덱스**: `ontology-retail-dev-kb-index`, single sharded
- **Nori Korean analyzer** — BM25 어휘 매칭에 한국어 형태소 분석
- **Cohere `embed-v4` 1024차원 KNN** — 의미 검색
- **RRF (Reciprocal Rank Fusion)**로 BM25+KNN 결합 → Cohere `rerank-v3`이 top 50을 재정렬 → 최종 top 10
- **Auto-id only** — custom `_id` 거부 (AOSS 제약, 일찍 학습)

### Aurora PostgreSQL Serverless v2 (`ontology-retail-dev-aurora`)

- 세션 메타데이터 + Cognito 사용자 매핑
- ACU 0.5–16 자동 스케일
- **비밀**은 Secrets Manager에서 startup에 fetch (env에 평문 저장 안 함)

### S3 Buckets (4개)

| 버킷 용도 | 내용 | Lifecycle |
|---|---|---|
| `raw-docs` | Bedrock Knowledge Base 적재 소스 (PDF, MD) | KB가 자동 sync |
| `uploads` | 사용자 업로드 (시나리오에서 사용) | 30일 후 Glacier |
| `synthetic-data` | 로더 소스 (products/reviews/personas + logistics) | 버전 관리 |
| `ontology-snapshots` | 버전 관리된 ontology dump | 무기한 |

추가로 **ALB access logs용** 버킷도 별도 존재.

### KMS Keys

- 각 데이터 자원마다 customer-managed key (Aurora, S3, OpenSearch, CloudWatch logs)
- 자동 회전 enabled
- IAM 정책으로 ECS task role만 사용 가능

---

## 4. AI & Memory — 데모의 핵심

### Bedrock Foundation Models

| 모델 | 용도 | 호출 위치 |
|---|---|---|
| **Sonnet 4.6** (`global.anthropic.claude-sonnet-4-6`) | 채팅(B), 인사이트(C)의 Korean answer 생성 + 도구 호출 | `api/services/agent.py` |
| **Cohere `embed-v4`** (1024d, `global.cohere.embed-v4:0`) | 쿼리 + 문서 임베딩 (KNN feeder) | `api/services/search.py` |
| **Cohere `rerank-v3`** (cross-region inference profile) | RRF 후 top-K 재정렬 | `api/services/search.py` (실패 시 RRF 순서 유지하며 fallback) |

> Sonnet 4.6은 **never Haiku-Lite** ([CLAUDE.md](../CLAUDE.md) 규칙). 채팅·인사이트 모두 동일 모델 — analytical voice quality 일관성 유지.

### Bedrock Knowledge Base (`<knowledge-base-id>`)

- `raw-docs` S3 위에 managed RAG
- 자동 청킹·임베딩·OpenSearch 적재
- API의 `kb_lookup` agent tool로 호출

### Bedrock Guardrails (`<guardrail-id>`)

- Input scrub: 채팅·검색 — PII / harmful content 거름
- Output scrub: 인사이트 answer — 부적절 콘텐츠 차단
- 실패는 non-fatal (요청 자체를 막지 않음, 로그만)

### AgentCore Memory (`ontology_retail_dev_memory-<suffix>`)

**시나리오 B 다회차 채팅의 핵심.**

- **Short-term**: 세션별 이벤트 (대화 흐름)
- **Long-term**: 사용자 namespace에 정착되는 fact (예: "이 사용자는 임산부 페르소나")
- **TTL 7일**
- **CDK 통합 gotcha** ([ADR-0001](decisions/0001-agentcore-memory-via-aws-custom-resource.md)) — L2 construct 없어 `AwsCustomResource` v3 explicit form, IAM은 `bedrock-agentcore:*` (not `bedrock-agentcore-control:*`), 이름은 underscore-only regex
- **네임스페이스 변수**: `{actorId}` + `{sessionId}` (NOT `userId`)

### AgentCore Code Interpreter

- **Firecracker microVM** — 매 호출마다 격리된 sandbox
- **matplotlib + NanumGothic 폰트** 번들 — 한글 차트 렌더 가능
- **시나리오 C**: Sonnet이 trend 데이터를 chart_spec으로 만들면 Code Interpreter가 실제 PNG 생성

> 이 4개 Bedrock primitive(Sonnet + Cohere embed + Cohere rerank + Knowledge Base) + 2개 AgentCore primitive(Memory + Code Interpreter)가 동시에 협주하는 것이 이 데모의 *진짜 가치*입니다. 다른 클라우드는 이걸 단일 매니지드 surface로 제공 못 합니다 (각각 다른 서비스로 직접 조립해야 함). "Knowledge Graph + RAG + Agent + 차트 생성"이 한 화면에서 작동하는 게 영업 hook.

---

## 5. Networking — VPC 토폴로지

### VPC + Subnets

- **CIDR**: `10.20.0.0/16`
- **2 AZ** (`ap-northeast-2a`, `ap-northeast-2c`)
- **Public subnets**: ALB, NAT
- **Private (with-egress) subnets**: ECS tasks (api/web), VPC endpoints
- **Private (isolated) subnets**: Neptune, Aurora (인터넷 접근 자체 불가)

### NAT Gateway

- **단일 NAT** (NAT EIP 1개) — 비용 vs HA 트레이드오프 (production은 AZ별 NAT 권장)
- ECS tasks의 outbound (Bedrock, ECR pull)에 사용

### VPC Endpoints (Interface)

ECS tasks가 AWS 서비스를 NAT 경유 없이 호출:

- `s3` (Gateway endpoint, free)
- `secretsmanager`, `ssm`, `kms`, `logs`, `ecr.api`, `ecr.dkr`, `bedrock-runtime`
- 비용: Interface endpoint은 시간당 ~$0.01/AZ + GB transfer

### Security Groups (계층 분리)

| SG | Ingress 허용 |
|---|---|
| `albSg` | 80/443 from CF prefix list만 |
| `webSg`, `apiSg` | ALB SG에서만 |
| `auroraSg` | apiSg에서만 5432 |
| `neptuneSg` | apiSg에서만 8182 |
| `vpceSg` | apiSg, webSg에서만 443 |

각 SG가 다음 SG의 source가 되는 *체인 패턴* — production grade.

---

## 6. Security & Secrets

### Secrets Manager

| 비밀 | 용도 |
|---|---|
| Origin auth token | CloudFront → ALB X-Origin-Auth-Token 헤더 값 |
| Aurora password | startup에 API가 fetch |

각 secret은 개별 회전 정책. Origin auth secret 캐시는 **5분 TTL** (이전엔 무한 lru_cache로 오래된 값을 사용하는 버그 있었음 — `50a059a` 커밋에서 수정).

### IAM 구조

- **API task role**: Bedrock invoke, Neptune read/write, OpenSearch index, Secrets Manager read, S3 read/write per bucket, AgentCore invoke
- **Web task role**: 최소 권한 (CloudWatch logs만)
- **Lambda@Edge role**: CloudWatch logs (Lambda@Edge는 외부 API 호출 안 함)
- **Loader role**: API role이 그대로 (one-shot으로 같은 task definition 사용)

---

## 7. Observability & Cost

### CloudTrail

- **Management events only** (data events for Bedrock은 CloudTrail 이벤트 타입이 아님 — 이거 잘못 알아 시간 낭비한 일이 있어 [ADR-0002](decisions/0002-cloudtrail-via-cfntrail-with-manual-bucket-policy.md)로 정리)
- **L1 `CfnTrail`** 사용 (CDK 2.150 L2 버그 회피, 버킷 정책 수동 추가)
- **데니리스트로 보호**: `cloudtrail delete-trail*`, `stop-logging*`은 우리 deny list에서 차단 (audit-blinding 방지)

### CloudWatch Logs

- `/aws/ecs/ontology-retail-dev/api` — uvicorn + FastAPI logs
- `/aws/ecs/ontology-retail-dev/web` — Next.js logs
- AWS WAF logs (CloudFront 설정 시)
- Log group별 KMS 암호화

### CloudWatch Alarms (account-level)

- Bedrock Converse error rate
- Neptune CPU
- OpenSearch search-rate

### ALB Access Logs

- S3 보관 → 30일 후 Glacier transition

### AWS Cost Anomaly Detection

- `Default-Services-Monitor` 구독, email 알림
- 데모 budget guardrail

### AWS Budgets

- **월 1000 USD** 한도 설정 (`ObservabilityStack`에 `monthlyBudgetUsd: 1000`)

---

## 8. CDK 스택 책임 매핑

[infra-cdk/CLAUDE.md](../infra-cdk/CLAUDE.md)에서 stack별 명확 분리:

| Stack | 자원 | 의존 |
|---|---|---|
| **OntologyRetailNetwork** | VPC, subnets, NAT, VPC endpoints, SGs | (root) |
| **OntologyRetailData** | Neptune, OpenSearch, Aurora, S3, KMS keys | Network |
| **OntologyRetailAi** | Bedrock Guardrail, KB, AgentCore Memory | Data |
| **OntologyRetailCompute** | ECS cluster + services, ALB, ECR, IAM | Network + Data + Ai |
| **OntologyRetailEdge** | CloudFront, Lambda@Edge, Cognito | Compute (cross-region us-east-1) |
| **OntologyRetailObservability** | CloudTrail, CloudWatch alarms, Cost Anomaly | Compute + Data + Ai |

**테스트**: `infra-cdk/test/stacks.test.ts`가 6개 stack 모두 jest snapshot으로 검증 (CI에서 매 push마다).

---

## 9. 시나리오별 자원 사용 매트릭스

각 시나리오가 어떤 자원을 부르는지:

| | Neptune | OpenSearch | Bedrock Sonnet | Cohere Embed/Rerank | KB | Memory | Code Interp | AgentCore tools |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **A** Search | ✓ subgraph | ✓ BM25+KNN | | ✓ | | | | |
| **B** Chat | ✓ traversal | ✓ via tool | ✓ stream | ✓ | ✓ via tool | ✓ both | | semantic_search, kb_lookup, neptune_subgraph, memory_recall |
| **C** Insights | ✓ aggregation | | ✓ stream | | | | ✓ chart | |
| **D** Persona Match | ✓ HAS_CONCERN | | | | | | | |
| **E** Safety | ✓ traversal | | | | | | | + Guardrails on input |
| **F** Substitute | ✓ same-cat | | | | | | | |
| **G** Price | ✓ AVAILABLE_IN | | | | | | | |
| **H** Logistics | ✓ Route+Inv | | ✓ via panel | | | | | inventory_lookup, nearest_warehouses, shortest_path |

---

## 10. 비용 분포 (대략)

월 ~770 USD baseline 중 큰 항목:

1. **Neptune**: 가장 큼 (~250 USD/월, db.r6g.large 24/7)
2. **NAT Gateway** + Interface VPC endpoints: ~80–120 USD/월
3. **Aurora Serverless v2** ACU baseline: ~100 USD/월
4. **OpenSearch Serverless** OCU minimum: ~150 USD/월
5. ECS Fargate (4 task × ARM64 small): ~50 USD/월
6. CloudFront, ALB, S3, CloudWatch: 각 ~10–30 USD/월
7. Bedrock invoke: 사용량 기반 (데모 트래픽이 적어 소액)
8. AgentCore Memory: 메모리 저장량 기반 (데모는 낮음)

---

## 관련 문서

- 시스템 개요와 데이터 플로우: [docs/architecture.md](architecture.md)
- 4개 ADR (CDK 트레이드오프 결정): [docs/decisions/](decisions/)
- 6 CDK 스택 코드: [infra-cdk/lib/](../infra-cdk/lib/)
- 보안 트레이드오프 + production 마이그레이션: [SECURITY.md](../SECURITY.md)
- 시나리오별 API: [docs/api-reference.md](api-reference.md)
- 신규 기여자 온보딩: [docs/onboarding.md](onboarding.md)
