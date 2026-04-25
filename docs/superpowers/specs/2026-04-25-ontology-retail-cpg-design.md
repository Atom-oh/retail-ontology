# Ontology Demo for Korean Retail/CPG — Design Spec

| Field | Value |
|---|---|
| Spec date | 2026-04-25 |
| Status | Draft (awaiting user review) |
| Target region | ap-northeast-2 (Seoul) |
| Target audience | 한국 Retail/CPG 영업 PoC 데모 (30–60분) |
| Reference IaC | https://github.com/whchoi98/ec2_vscode/tree/main/infra-cdk |

---

## 1. Goal

> **한국 Retail/CPG 고객의 일상(편의점·드럭스토어·뷰티)을 코어 데이터로, 표준 기반 온톨로지 + Bedrock RAG + AgentCore 에이전트가 어떻게 쇼퍼 경험과 MD 의사결정을 동시에 만들어 내는지를 30–60분 안에 보여주는 영업 데모를 구축한다.**

청중에게 "AWS Bedrock + AgentCore + Neptune 조합으로 우리 도메인에도 가능"이라는 구체적 확신을 전달한다.

### 1.1 Non-Goals
- 실제 고객 데이터 사용 (NDA가 있는 단일 고객 PoC가 아님).
- Production-grade 멀티 테넌시·과금·결제 플로우.
- SageMaker 기반 커스텀 모델 학습 (이번 데모에서 제외, 확장 카드).
- Q Business 통합 (제외, 확장 카드).
- 5만+ SKU 스케일 검증 (250 SKU 데모; 스케일은 follow-up PoC 카드).

### 1.2 Success Criteria
1. 30분 내에 시나리오 A·B·C 라이브 시연 완료, 끊김 없음.
2. 시연 직후 follow-up 미팅 또는 PoC 요청 1건 이상 발생 (영업 KPI).
3. AWS Bedrock + AgentCore + Neptune 조합이 한 흐름에 자연스럽게 등장.
4. "All data in Seoul" 메시지가 슬라이드/아키텍처에 일관되게 노출.
5. p95 검색 응답 < 3초, 에이전트 첫 토큰 < 2초.

---

## 2. Audience

| 페르소나 | 관심사 | 데모 후크 |
|---|---|---|
| CDO / 디지털전환 임원 | 비즈니스 임팩트, AI 차별화 | 시나리오 B(에이전트), 시나리오 C(MD 인사이트) |
| MD / 상품기획 / 마케팅 임원 | 트렌드, 의사결정 도구, ROI | 시나리오 C 전체 |
| 데이터·IT 플랫폼 리더 | 아키텍처, 거버넌스, 운영 비용 | 청크 3(보안/거버넌스/비용), 빌드 단계 |

---

## 3. Decision Log

브레인스토밍 세션(2026-04-25)에서 합의된 12개 핵심 결정.

| # | 결정 영역 | 채택안 |
|---|---|---|
| 1 | 데모 목적 | 영업/PoC 데모 (한국 Retail/CPG, 30–60분) |
| 2 | 산업 도메인 | 그로서리/편의점 + 뷰티/생활용품 (B+D) |
| 3 | 킬러 시나리오 | A. 의미 검색 / B. 대화형 에이전트 / C. MD 인사이트 |
| 4 | AI 코어 | Bedrock Knowledge Bases + Amazon Neptune (이중 RAG) |
| 5 | AI 보조 | AgentCore 프리미티브 풀 활용 (Runtime/Memory/Gateway/Browser/Code Interpreter) + Bedrock Guardrails |
| 6 | 온톨로지 | 표준 골격(GS1 GPC + FoodOn + INCI + schema.org) + 한국화 어댑터 + LLM 자동 추출 코너 |
| 7 | 리전 | ap-northeast-2 (Seoul) 단일, AgentCore 풀스택 GA 확인 |
| 8 | 데이터 | 공공 데이터(영양/성분) + 합성(상품/리뷰/페르소나), 합성 PII로 Guardrails 시연 |
| 9 | 한국어 검색 | Cohere Multilingual + OpenSearch Nori 형태소 + Bedrock Reranker (Cross-Region Inference Profile) |
| 10 | 프론트/백엔드 | Next.js 14 (App Router/TS) + Python FastAPI 분리, ECS Fargate 두 서비스 |
| 11 | 운영 | Always-On / CloudFront + Lambda@Edge + Cognito / CDK TypeScript |
| 12 | 코드 구조 | 단순 모노 디렉토리 / Cytoscape.js / 도메인은 빌드 후 결정 |

---

## 4. Demo Flow (35분 권장)

### 4.1 Scenario A — Semantic Search (8–10분, B2C 쇼퍼)

1. 오프닝 쿼리: "여름철 민감성 피부에 좋은 선크림 추천해줘"
2. 결과 우측 패널에 온톨로지 그래프 라이브 부각 (Cytoscape.js, 노드: `Skin_Concern.Sensitive`, `Season.Summer`, `Product.Sunscreen`)
3. 도메인 전환 쿼리: "글루텐프리 4세 아이 간식, 100칼로리 이하" — 같은 코어 온톨로지 동작
4. 시연자 멘트: "쿼리가 키워드가 아니라 온톨로지 그래프 위 경로로 풀립니다 — 왜 이 SKU가 답인지 설명 가능합니다."
5. 기술 비하인드: Cohere 임베딩 + Nori 형태소 + Bedrock Reranker 3단 파이프라인 (슬라이드 1장).

### 4.2 Scenario B — Conversational Shopping Agent (12–15분, B2C 멀티턴)

1. 첫 질문: "다음 주 캠핑 가는데 필요한 걸 챙겨줘" — 컨텍스트 모호.
2. 에이전트가 AgentCore Memory 조회 → "지난 대화에서 임산부라 알려주셨네요. 카페인·알코올은 빼겠습니다." (Memory 시연)
3. 우측 백엔드 로그 패널에 `kb.retrieve(...)`, `neptune.query(...)` 호출 실시간 표시 (Gateway 시연)
4. PII 입력 유도(예: 가짜 주민번호) → Guardrails 자동 마스킹 시연
5. "메모리는 7일간 유지, 다음 방문 시 자동 컨텍스트" — 단기/장기 메모리
6. 임팩트 멘트: "에이전트는 단일 LLM이 아니라 메모리·도구·가드레일이 결합된 AgentCore 풀스택."

### 4.3 Scenario C — MD/Marketer Insights (10–12분, B2B)

1. 같은 데모에서 MD 페르소나로 재로그인 (Cognito 그룹 전환).
2. 자연어 BI: "지난 4주간 20대 여성에게 검색 빈도가 급증한 성분 Top10, 카테고리별로"
3. AgentCore Code Interpreter가 OpenSearch + Aurora 분석, 차트 즉석 생성, 인라인 임베드.
4. 결과 클릭 → Cytoscape.js로 "성분 → SKU → 리뷰 감성 → 경쟁 브랜드" 그래프 드릴다운.
5. **LLM 자동 추출 코너 (5분)**: 신상품 PDF 업로드 → Claude가 온톨로지 스키마 따라 자동 분류·매핑 → Neptune 적재 라이브 시연.
6. 클로저: "쇼퍼의 검색·대화 데이터가 그대로 MD 의사결정 도구가 됩니다 — 같은 백본, 다른 화면."

---

## 5. Architecture

```
[User · Browser]
       │ HTTPS
       ▼
[CloudFront Distribution]
       │
       ├── Lambda@Edge (us-east-1)  ──→  Cognito User Pool (Seoul, JWT 검증)
       │   (cognito-at-edge 패턴)
       │
       └── Origin = ALB (HTTP, Seoul)
            (ALB SG ingress = AWS Managed Prefix List
              "com.amazonaws.global.cloudfront.origin-facing")
            │
            ├──/_next, /, /chat, /md/* ─→ ECS Service: web (Next.js)
            └──/api/*                  ─→ ECS Service: api (FastAPI)
                                           │
                                           ├─ Bedrock Runtime (Claude / Cohere Embed)
                                           ├─ Bedrock Knowledge Bases
                                           ├─ Bedrock Reranker (Cross-Region IP)
                                           ├─ Bedrock Guardrails
                                           ├─ AgentCore Runtime / Memory / Gateway
                                           │   / Code Interpreter / Browser
                                           ├─ Neptune Serverless (graph)
                                           ├─ OpenSearch Serverless (vector + Nori)
                                           ├─ Aurora PostgreSQL Serverless v2
                                           └─ S3 (KMS)
```

### 5.1 Network/Edge Topology

| Item | Value |
|---|---|
| VPC CIDR | `10.20.0.0/16` (참조 repo `10.254.x.x` 충돌 회피) |
| AZ | 2 (ap-northeast-2a, 2c) |
| Subnets | Public (/24×2, ALB), Private-Egress (/24×2, Fargate/Aurora/Neptune) |
| NAT | 1 (단일 AZ NAT, 비용 절감) |
| VPC Endpoints | S3 (Gateway), ECR API/DKR, CloudWatch Logs, Secrets Manager, Bedrock Runtime, Neptune (Interface) |

### 5.2 Security Group Matrix

| SG | Ingress | Note |
|---|---|---|
| `alb-sg` | CloudFront managed prefix list, port 80 | 참조 repo 패턴 |
| `web-sg` | `alb-sg`, port 3000 | Next.js |
| `api-sg` | `alb-sg`, port 8000 | FastAPI |
| `aurora-sg` | `api-sg`, port 5432 | |
| `neptune-sg` | `api-sg`, port 8182 | Gremlin/SPARQL |
| `vpce-sg` | VPC CIDR, port 443 | VPC Endpoints |

### 5.3 ALB Listener Rules

```
Listener :80
  Rule 1 (priority 10): path-pattern "/api/*"   → tg-api  (port 8000, target type ip)
  Rule 2 (default):                              → tg-web (port 3000, target type ip)
Health checks:
  tg-web: GET /api/health-web (Next.js route handler)
  tg-api: GET /healthz (FastAPI)
```

> 데모 단계는 ALB 리스너 80(HTTP). CloudFront ↔ ALB 구간은 AWS 백본 + Origin Shield(선택)로 보호. 운영 단계는 ACM + ALB :443으로 격상.

---

## 6. Component Catalog

### 6.1 Edge / Auth

| Component | Region | Purpose |
|---|---|---|
| Route 53 | global | 커스텀 도메인 (빌드 후 결정) |
| CloudFront Distribution | global | HTTPS, 캐시 정책 (정적 vs 동적 분리) |
| Lambda@Edge | **us-east-1** | Viewer Request: Cognito JWT 쿠키 검증, 미인증 시 Cognito Hosted UI로 302 |
| Cognito User Pool | ap-northeast-2 | admin-managed users (`lotte@demo`, `shinsegae@demo` 등), self-signup off, 그룹: `shopper`/`md`/`admin` |
| Cognito Hosted UI | ap-northeast-2 | 기본 OAuth 플로우, 한국어 라벨 커스텀 |
| WAF (선택) | global (CF) | rate limit (분당 IP당 100), Geo (KR + 화이트리스트), AWS Managed Common Rules |

### 6.2 Compute

| Component | Spec | Note |
|---|---|---|
| ECS Cluster | Fargate (default, no FARGATE_SPOT) | 단일 클러스터 |
| Service `web` | Next.js 14, ARM64, 0.5 vCPU / 1 GB, 2 task | App Router, Tailwind, shadcn/ui, Cytoscape.js, Pretendard |
| Service `api` | Python 3.12 + FastAPI, ARM64, 1 vCPU / 2 GB, 2 task | boto3, Bedrock SDK, AgentCore SDK, gremlin/SPARQL 클라이언트 |
| ECR | 2 repos (`ontology-web`, `ontology-api`) | scan-on-push |

### 6.3 Data

| Component | Spec | Purpose |
|---|---|---|
| Neptune Serverless | NCU 1–8 (min 1) | Property Graph + SPARQL, 온톨로지 |
| Aurora PostgreSQL Serverless v2 | 0.5–2 ACU | 사용자 세션, 검색/대화 로그, 데모 이벤트 |
| OpenSearch Serverless | 2 OCU 최소 (1 indexing + 1 search), Nori 분석기 | KB 백엔드 + 앱 검색 (Vector + BM25 하이브리드) |
| S3 buckets (KMS) | `raw-docs`, `synthetic-data`, `ontology-snapshots`, `uploads` | KB 소스, 데이터 자산, 스냅샷, 시연 PDF |

### 6.4 AWS AI

| Service | Use |
|---|---|
| Bedrock Runtime | Claude Sonnet 4.6 (대화/추론), Haiku 4.5 (라이트), Cohere Embed Multilingual v3 (임베딩) |
| Bedrock Knowledge Bases | 비정형 텍스트 RAG (상품설명·리뷰·매뉴얼), 벡터 백엔드 = OpenSearch Serverless |
| Bedrock Reranker | Cohere Rerank 3, **Cross-Region Inference Profile** (호출 ARN은 Seoul, 백엔드 us-east-1/us-west-2) |
| Bedrock Guardrails | Korean PII (RRN/phone/address/name), 콘텐츠 필터, 사용자 정의 토픽 |
| AgentCore Runtime | 멀티턴 추론, 도구 오케스트레이션 |
| AgentCore Memory | session(short-term) + 7일 long-term |
| AgentCore Gateway | 도구 노출: `kb.retrieve`, `neptune.query`, `search.semantic`, `code.run` |
| AgentCore Code Interpreter | 샌드박스 pandas/matplotlib 실행 (시나리오 C 차트) |
| AgentCore Browser | 외부 트렌드 스크랩 (시연 시점 가용성 재확인, 미가용 시 합성 폴백) |

### 6.5 Observability / Security

| Component | Use |
|---|---|
| CloudWatch Container Insights | ECS 메트릭/로그 |
| CloudWatch Logs | 모든 Fargate, Lambda@Edge, ALB |
| X-Ray | Web → API → Bedrock/Neptune/OpenSearch trace |
| KMS CMK ×5 | S3, Aurora, Neptune, OpenSearch, CloudWatch Logs |
| Secrets Manager | Aurora 비밀번호, 외부 API 키 |
| CloudTrail | Bedrock 데이터 이벤트, Cognito 이벤트, S3 30일 보존 |

---

## 7. Data Flows

### 7.1 Scenario A — Semantic Search

```
User → CloudFront → Lambda@Edge (JWT)
     → ALB → web (Next.js render)
     → User input
     → POST /api/search { q, persona }
        ├─ embedding.py    : Bedrock InvokeModel (Cohere Multilingual)
        ├─ search.py
        │   ├─ OpenSearch hybrid (Nori BM25 + KNN, top 100)
        │   └─ Bedrock Reranker (Cross-Region IP, top 10)
        ├─ neptune.py      : openCypher MATCH 관련 서브그래프
        └─ guardrails.py   : 응답 PII 스크럽
     ← { hits, subgraph }
web → Cytoscape.js 그래프 + 결과 카드 동시 렌더
```

### 7.2 Scenario B — Conversational Agent

```
User → POST /api/chat (SSE stream) { session_id, msg }
api
  ├─ memory.retrieve(session_id) → 단기/장기 컨텍스트
  ├─ AgentCore Runtime.invoke
  │   ├─ Claude Sonnet 추론
  │   ├─ Tool calls via Gateway:
  │   │   ├─ search.semantic(q)   ── Scenario A 파이프라인 재사용
  │   │   ├─ kb.retrieve(q)       ── Bedrock KB
  │   │   ├─ neptune.query(cypher)── 그래프 질의
  │   │   └─ memory.write(facts)
  │   └─ Guardrails 응답 후처리
  └─ stream chunks back (SSE)
web → 채팅 UI + 우측 백엔드 로그 패널 + Cytoscape.js 부각
```

### 7.3 Scenario C — MD Insights + LLM Auto-Extraction

```
MD → /md/insights "지난 4주 20대 여성 검색 폭증 성분"
api → AgentCore Runtime + Code Interpreter
       ├─ Tool: opensearch.aggs (Aurora 검색 로그) → DataFrame
       ├─ Code Interpreter: pandas 분석 + matplotlib 차트(PNG)
       └─ neptune.query: 결과 성분 → SKU → 리뷰 감성
web → 차트 인라인 + 클릭 → Cytoscape.js 드릴다운

LLM 자동 추출 코너:
MD → 신상품 PDF 업로드 → POST /api/ingest/pdf
api → Textract/pdfplumber → Claude (structured output, ontology schema)
       → 검증 → Neptune 적재 → KB sync → 라이브 그래프 갱신
```

---

## 8. Ontology Data Model

### 8.1 Core Classes (12)

`Product`, `Category`, `Brand`, `Manufacturer`, `Ingredient`, `Nutrient`, `Persona`, `Concern`, `Review`, `Trend`, `Promotion`, `Channel`.

그로서리/CPG와 뷰티는 같은 코어 모델을 공유. 도메인 차이는 `Ingredient`의 하위 분류(FoodOn vs INCI)와 `Nutrient`의 유무로만 표현 — 한 그래프 안에 두 도메인이 자연 공존.

### 8.2 Core Relations (Property Graph)

```
(:Product)-[:IN_CATEGORY]->(:Category)
(:Product)-[:BY_BRAND]->(:Brand)
(:Brand)-[:MANUFACTURED_BY]->(:Manufacturer)
(:Product)-[:HAS_INGREDIENT {amount}]->(:Ingredient)
(:Ingredient)-[:CONTAINS_NUTRIENT {per100g}]->(:Nutrient)
(:Persona)-[:HAS_CONCERN]->(:Concern)
(:Concern)-[:AVOIDS_INGREDIENT]->(:Ingredient)
(:Concern)-[:PREFERS_INGREDIENT]->(:Ingredient)
(:Review)-[:ABOUT]->(:Product)
(:Review)-[:WRITTEN_BY]->(:Persona)
(:Trend)-[:INVOLVES]->(:Ingredient | :Product | :Category)
(:Product)-[:SOLD_AT]->(:Channel)
(:Promotion)-[:APPLIES_TO]->(:Product | :Category)
```

### 8.3 Standard → Korean Adapter Mappings

| 표준 | 한국 어댑터 | 예시 |
|---|---|---|
| GS1 GPC Brick | 식약처 식품분류 / 올리브영·컬리 카테고리 | `10000604` → "스낵/과자" |
| schema.org/Product.gtin | KAN (한국 EAN-13) | `8801121234567` |
| FoodOn (Food Ontology) | 식약처 식품영양성분 DB / 한글 식품명 | `FOODON:03301159` → "현미 통곡물" |
| INCI (화장품 성분 국제표준) | 식약처 화장품성분사전 / 한글 성분명 | `NIACINAMIDE` → "나이아신아마이드" |
| schema.org Person | 한국 연령/성별 라벨 | `persona:f-20s-sensitive-skin` |

### 8.4 Demo Data Sizes

| Entity | Count | Source |
|---|---|---|
| Product (SKU) | 250 | 합성 (그로서리 125 + 뷰티 125) |
| Category | ~80 | GS1 + 한국 어댑터 트리 |
| Brand | 60 | 합성 |
| Manufacturer | 30 | 합성 |
| Ingredient | ~300 | FoodOn 100 + INCI 200 (공공) |
| Nutrient | 40 | FoodOn (공공) |
| Persona | 40 | 합성 |
| Concern | 25 | 합성 |
| Review | 2,500 | 합성 (Claude) |
| Trend | 30 | 합성 (LLM 추출 시연 일부) |
| **Total nodes / edges** | **~3,300 / ~12,000** | Neptune Serverless 1 NCU 충분 |

### 8.5 Data Boundary — Authoritative vs Narrative

- **권위 있는 사실 (공공)**: `Ingredient`, `Nutrient` — 식약처/FoodOn/INCI ID로 결합.
- **합성 서사**: `Product`, `Review`, `Persona`, `Trend` — Claude 생성, 시연 wow 모멘트에 맞춰 튜닝.
- 두 영역은 표준 ID(GS1 GPC, INCI)로 조인. 시연 중 "공공 + 생성 데이터의 거버넌스 분리"의 살아있는 예시로 활용.

### 8.6 Wow-Moment Tuning

SKU 250개 중 30~50개에 대해 한국어 시노님(예: "여드름성"→`Concern.Acne`, "민감성"→`Concern.Sensitive_Skin`)을 사전 보강한다. 시나리오 A의 핵심 30 쿼리가 일관되게 정확하도록 하기 위함.

---

## 9. Project Layout

```
ontology-for-retail/
├── infra-cdk/                     # CDK TypeScript
│   ├── bin/app.ts
│   └── lib/
│       ├── network-stack.ts       # VPC, SG, VPC endpoints
│       ├── data-stack.ts          # Neptune, Aurora, OpenSearch, S3
│       ├── ai-stack.ts            # Bedrock KB, AgentCore Memory, Guardrails
│       ├── compute-stack.ts       # ECS cluster, services, ECR
│       ├── edge-stack.ts          # CloudFront, Cognito, Lambda@Edge (us-east-1)
│       └── observability-stack.ts # CW dashboards, alarms
├── web/                           # Next.js 14 (App Router)
│   ├── app/(shopper)/search/      # Scenario A
│   ├── app/(shopper)/chat/        # Scenario B
│   ├── app/(md)/insights/         # Scenario C
│   ├── app/api/auth/              # Cognito 콜백
│   └── components/graph/          # Cytoscape.js 래퍼
├── api/                           # FastAPI
│   ├── routers/{search,chat,insights,ingest}.py
│   ├── services/
│   │   ├── embedding.py           # Cohere 호출
│   │   ├── search.py              # OpenSearch 하이브리드 + 리랭크
│   │   ├── neptune.py             # openCypher / SPARQL
│   │   ├── kb.py                  # Bedrock KB retrieve
│   │   ├── agent.py               # AgentCore Runtime 호출
│   │   ├── memory.py              # AgentCore Memory
│   │   ├── guardrails.py          # PII 사전 스크럽
│   │   └── ingest.py              # PDF→Claude→Neptune
│   └── main.py
├── data/                          # 일회성 데이터 생성/적재 스크립트
│   ├── public/{foodon,inci,kfda}.py
│   ├── synthetic/{products,reviews,personas}.py
│   └── load.py
├── ontology/                      # Neptune 스키마, 매핑 룰
│   ├── schema.ttl                 # OWL/RDF 스키마
│   ├── adapters/{gs1_to_korean,inci_to_korean}.py
│   └── upload.py
├── docs/
│   ├── superpowers/specs/
│   └── architecture/
├── .gitignore
└── README.md
```

---

## 10. Security & Governance

| 영역 | 구현 |
|---|---|
| 인증 | Cognito User Pool (Seoul), admin-managed users, self-signup off, MFA optional, 그룹: `shopper`/`md`/`admin` |
| 인가 | Lambda@Edge JWT 검증 + API 측 Bearer 검증 + 그룹별 라우트 가드 (`/md/*`는 md only) |
| 암호화 (rest) | KMS CMK 5개: S3 / Aurora / Neptune / OpenSearch / CloudWatch Logs |
| 암호화 (transit) | CF↔ALB HTTPS. ALB→Fargate 내부 HTTP (VPC private) — 데모 허용. 운영 격상 시 ACM Private CA로 mTLS. |
| PII 보호 | Bedrock Guardrails (한국 RRN / 휴대폰 / 주소 / 이름 토픽). Reranker 호출 직전 사전 스크럽 강제. |
| 콘텐츠 안전 | Guardrails 사용자 정의 토픽: 임산부에 알코올/카페인 차단, 미성년에 성인 콘텐츠 차단, 경쟁 브랜드 비방 차단. |
| 시크릿 | Secrets Manager. Fargate task IAM role로 retrieve. ENV 평문 노출 금지. |
| 네트워크 격리 | Bedrock/S3/ECR/CloudWatch Logs는 VPC Endpoint 사용. 인터넷 우회 0. |
| 감사 | CloudTrail 데이터 이벤트 (Bedrock), Cognito 이벤트, ALB 액세스 로그 → S3, 30일 보존. |
| WAF (선택) | rate limit (분당 IP당 100), Geo (KR + 화이트리스트), AWS Managed Common Rules. |

### 10.1 IAM Roles (요약)

| Role | Trust | Permissions |
|---|---|---|
| `ecs-task-role-web` | ecs-tasks | CloudWatch Logs |
| `ecs-task-role-api` | ecs-tasks | Bedrock invoke (Claude/Cohere/Reranker/Guardrails), Neptune connect, OpenSearch query, Aurora secret read, S3 read (KB 소스), CloudWatch Logs, X-Ray |
| `lambda-edge-role` | lambda + edgelambda | Cognito JWKS retrieve, CloudWatch Logs (us-east-1) |
| `bedrock-kb-role` | bedrock | S3 read (raw-docs), OpenSearch write |

### 10.2 Reranker Cross-Region Note

Reranker로 보내는 텍스트는 **Top-N 검색 후보(상위 100개 텍스트 청크)**로, 일시적으로 us 리전에서 처리됨. 데이터 거주성 메시지 유지를 위해:

- 호출 직전 Guardrails로 PII 사전 스크럽.
- "Top-N candidates only, ephemeral, no PII" 슬라이드 footnote 명시.
- 향후 Reranker가 서울 GA되면 `InferenceProfileArn` 환경 변수 한 줄 변경으로 마이그레이션.

---

## 11. Cost Estimate (월, USD, ap-northeast-2)

| 항목 | 산정 | 추정 |
|---|---|---|
| Fargate web (2 task × 0.5 vCPU × 1 GB) | 24/7 | $35 |
| Fargate api (2 task × 1 vCPU × 2 GB) | 24/7 | $70 |
| ALB | 1 + LCU | $25 |
| NAT Gateway | 1 + 데이터 | $40 |
| Neptune Serverless | 1–8 NCU, 평시 1 | $130 |
| Aurora Serverless v2 | 0.5–2 ACU, 평시 0.5 | $40 |
| **OpenSearch Serverless** | 2 OCU 최소 (1 idx + 1 search) | **$350** ← 최대 비용 |
| S3 / KMS / Secrets | | $10 |
| CloudFront / Cognito / Lambda@Edge | 데모 트래픽 | $10 |
| Bedrock 호출 (모델/임베딩/Reranker/Guardrails) | ~5K invoke/월 | $30–50 |
| AgentCore Memory/Runtime | 데모 사용량 | $10–20 |
| CloudWatch / X-Ray | | $15 |
| **합계 (Always-On baseline)** | | **~$770/월** |

### 11.1 Cost Optimization Knobs (선택 적용)

| 옵션 | 절감 | 트레이드오프 |
|---|---|---|
| OpenSearch Serverless → 관리형 t3.small.search 단일 노드 | -$300 | KB 호환성 일부 손실, "데모 환경" 명시 필요 |
| Neptune Serverless → t4g.medium 프로비저닝 | -$60 | 24/7 일정 비용, 스케일 한계 |
| NAT Gateway → NAT Instance (t4g.nano) | -$30 | 운영 부담 약간, 단일 장애점 |

세 옵션 모두 적용 시 **~$370/월**. **권장**: 첫 영업 데모는 안정성 우선 ($770/월), 시연 안정화 후 절감 옵션 도입.

### 11.2 Budget Alarm

- AWS Budgets: 월 $1,000 알람 → SNS Slack.
- Cost Anomaly Detection: 일별 1.5× 이상 변동 시 알림.

---

## 12. Observability

### 12.1 Custom Metrics

- `search.latency.{p50,p95,p99}`
- `agent.tool_call.count{tool}`
- `reranker.calls`, `reranker.latency`
- `guardrails.pii_redacted.count`
- `bedrock.tokens.{input,output}`
- `cytoscape.render.duration` (web)

### 12.2 CloudWatch Dashboard "Demo Health"

영업 발표자가 시연 직전 5분 점검에 사용할 단일 화면. 위 메트릭 + Fargate task health + Bedrock 5xx rate.

### 12.3 Alarms

| Alarm | Threshold | Action |
|---|---|---|
| Search p95 latency | > 3s | SNS Slack |
| Fargate task health | < 2 (any service) | 자동 복구 + SNS |
| Bedrock 5xx rate | > 5% / 5min | SNS Slack |
| Budget | > $1,000 / 월 | SNS Slack |

---

## 13. Risk Register

| 위험 | 가능성 | 영향 | 완화 |
|---|---|---|---|
| AgentCore Browser 서울 GA 격차 | 중 | 시나리오 C 외부 트렌드 코너 차질 | 합성 트렌드 데이터 폴백 + 시연 멘트 "이 코너는 모의 데이터" |
| Reranker cross-region 레이턴시 (~150 ms 추가) | 높 | 시나리오 A 검색 응답 체감 | UI 로딩 스피너, Top-100 제한, 인기 쿼리 사전 캐시 |
| 한국어 임베딩 도메인어 정확도 | 중 | 시나리오 A wow 약화 | 핵심 30 쿼리 사전 평가, 시노님/온톨로지 라벨 보강, BM25-only fallback |
| Neptune 초기 적재 시간 | 낮 | 빌드 30–40분 추가 | 스냅샷 백업/복원 |
| KB 인덱싱 시간 | 낮 | 동일 | 사전 인제스트 + 시연은 "신규 PDF만" |
| 합성 데이터 어색한 한국어 | 중 | 시연 신뢰 하락 | 한국어 검수 1회 + 명백한 오류 수정 |
| Cognito 임시 비번 운영 사고 | 낮 | 시연 차질 | "시연 5분 전 새 비번 발급" SOP, 백업 계정 1개 상시 |
| Bedrock 모델 장애 | 매우 낮 | 시연 중단 | Sonnet → Haiku 폴백 분기, 시연자 핸드오프 멘트 |
| Lambda@Edge 배포 실패 | 낮 | 사이트 401 | CDK `requireAuth` 컨텍스트 false 빌드로 빠른 우회 |
| 비용 폭주 | 중 | 영업 부담 | Budget 알람, AgentCore tool call rate limit, OpenSearch OCU 상한 |
| 청중에 우연한 PII 노출 | 매우 낮 | 신뢰 사고 | 합성 PII만 사용 검증, Guardrails 사전 검증 |

---

## 14. Build Phases

총 **~8주** (SA 1명 기준). 2–3명이면 4–5주로 압축.

| Phase | 기간 | 산출물 | 의존 |
|---|---|---|---|
| 0. 표준 매핑 시트 | 1주 | GS1↔식약처, INCI↔한글성분 매핑 CSV (Claude 1차 + 인간 검수) | — |
| 1. 데이터 생성 | 1주 | 합성 SKU 250 + 리뷰 2.5K + 페르소나 40, 공공 영양/성분 매핑 | Phase 0 |
| 2. CDK 인프라 | 1주 | network/data/edge/ai/compute 5 스택, dev 배포 검증 | — |
| 3. API 백엔드 | 2주 | search/chat/insights/ingest 엔드포인트, AgentCore 통합 | Phase 1, 2 |
| 4. Web 프론트 | 2주 | 시나리오 A/B/C 화면, Cytoscape.js 그래프 | Phase 3 (모킹으로 병렬 가능) |
| 5. 시연 검증 + 리허설 | 1주 | 30 핵심 쿼리 검증, 시연 시나리오 3회 리허설, 비용 점검 | Phase 4 |

---

## 15. Out of Scope / Future Cards

데모 종료 후 follow-up 카드:

- **A. Real Data PoC**: 고객 SKU 1만~5만 적재, 코어 그래프 그대로.
- **B. SageMaker 한국어 임베딩 fine-tune**: 도메인어 정확도 +α.
- **C. Q Business 인사이트 통합**: 자연어 BI를 회사 SSO 위에.
- **D. AgentCore Browser 정식 활용**: 외부 시장조사·경쟁사 모니터 자동화.
- **E. 멀티 도메인 확장**: 가전·패션·약국 등 어휘 어댑터만 추가.
- **F. mTLS in VPC**: ALB→Fargate ACM Private CA, production-grade 격상.
- **G. 멀티 리전 DR**: Tokyo 또는 us-west-2 standby.

---

## 16. Open Questions / Default Assumptions

다음 항목들은 명시적 답변이 없어 기본값으로 진행. 빌드 단계에서 필요 시 조정.

| 항목 | 기본값 | 변경 시 영향 |
|---|---|---|
| 데이터 규모 | SKU 250, 리뷰 2.5K, 페르소나 40 | 데이터 생성 스크립트 파라미터, Neptune NCU |
| 합성 PII 시연 | 포함 (Guardrails 라이브 시연) | Guardrails 정책 + 시연 시나리오 |
| 커스텀 도메인 | 빌드 후 결정 (CloudFront 기본 도메인 시작) | Route 53 + ACM (us-east-1) |
| 영업 직원의 시연 운영 | Cognito 임시 계정 admin 발급 SOP | SOP 문서 작성 필요 |
| CI/CD | 수동 `cdk deploy` 시작, 안정화 후 GitHub Actions | 워크플로우 yaml |
| AgentCore Browser | 빌드 단계에서 가용성 재확인 후 결정 | 미가용 시 합성 트렌드 폴백 |
| Streamlit 별도 코너 | 미포함 (디자인 일관성) | Next.js의 차트 컴포넌트로 대체 |

---

## 17. References

- 참조 IaC (CloudFront → Prefix-list SG → ALB 패턴): https://github.com/whchoi98/ec2_vscode/tree/main/infra-cdk
- AWS cognito-at-edge 패턴 (Lambda@Edge JWT 검증)
- GS1 GPC: https://www.gs1.org/standards/gpc
- FoodOn: https://foodon.org/
- INCI Beauty: https://incibeauty.com/
- Bedrock Knowledge Bases (Vector + RAG)
- Bedrock AgentCore (Runtime / Memory / Gateway / Code Interpreter / Browser)
- Bedrock Cross-Region Inference Profiles (Reranker)
- OpenSearch Nori 형태소 분석기
- Cytoscape.js
