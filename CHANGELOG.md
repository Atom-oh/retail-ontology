# Changelog

[![English](https://img.shields.io/badge/lang-English-blue.svg)](#english)
[![한국어](https://img.shields.io/badge/lang-한국어-red.svg)](#한국어)

---

# English

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Add `.github/workflows/ci.yml` — 4-job CI pipeline (`python-ast` compileall, `tsc-check` matrix [web, infra-cdk], `cdk-synth` + jest snapshot, `pytest`) on push/PR to main with concurrency cancel-in-progress
- Add `tests/` pytest suite — 28 tests in <1s: 16 router import smoke (`tests/test_smoke.py`) + 5 Pydantic model validation + 2 health + 5 `/api/search` integration with `httpx.AsyncClient` and boto3 mocked at the import-site (`tests/api/`)
- Add `tests/conftest.py` centralizing 18 dummy env vars at collection time + `DEMO_PUBLIC_MODE=true` + `REQUIRE_ORIGIN_AUTH=false` for ASGI-direct tests
- Add `infra-cdk/test/stacks.test.ts` — Jest snapshot tests for all 6 CDK stacks via `Template.fromStack().toJSON()` with deterministic test context (account `000000000000`); auto-generated 7727-line snapshot at `__snapshots__/stacks.test.ts.snap`
- Add `requirements-dev.txt` (pytest, pytest-asyncio, httpx) — dev-only, not installed in production Docker image
- Add `tests/CLAUDE.md` documenting test layout, conftest layering, ASGI fixture, mock-at-import-site convention, snapshot update flow
- Add 4 ADRs in `docs/decisions/` materializing session learnings: 0001 AgentCore Memory CDK AwsCustomResource pattern, 0002 CloudTrail L1 CfnTrail with manual bucket policy, 0003 Lambda@Edge stable-ID hardcoding, 0004 Cognito UserPoolClient CDK-only authoring
- Add `.claude/settings.json` (project-shared) — registers `PreToolUse` + `PostToolUse` + `Stop` hooks and a 60-entry `permissions.deny` covering MCP namespace bypass (`__delete_*`, `__execute_command`, serena `execute_shell_command`), CloudTrail audit-blinding (`delete-trail`, `stop-logging`), and the AWS IAM privilege-escalation triad (`attach-*-policy`, `create-policy-version`, `pass-role`)
- Add `.claude/hooks/scrub-secrets.sh` — PreToolUse + PostToolUse blocker for AKIA/ASIA, JWT, PEM private-key blocks, Slack tokens, GitHub PATs
- Add `.claude/hooks/changelog-reminder.sh` — Stop hook that flags structural file changes (api/routers, api/services, web/app/*/page.tsx, infra-cdk/lib/*-stack.ts, data/schemas.py, ontology/mappings/) without a CHANGELOG.md update
- Add `.claude/skills/wow-query-eval.md` — project-specific 30-query search quality gate skill with pre-flight checks
- Add `.claude/skills/cypher-conventions.md` — Neptune openCypher discipline (parameters keyword-only, no f-string interpolation, `_flatten_props` scalar coercion)
- Add `.claude/agents/{code-reviewer,security-auditor}.md` — `model: sonnet` pinned, structured `## Output format` section with severity taxonomy, finding shape, and termination phrase
- Add 5 module-level `CLAUDE.md` files now git-tracked (`api/`, `web/`, `data/`, `infra-cdk/`, `ontology/`) plus root `CLAUDE.md`
- Add `.harness-eval/` score history — 4 evaluations recorded (6.0/C → 5.5/D → 6.9/C → 7.9/B); README badge auto-updated
- Add Scenario H logistics network with Korean choropleth map (`react-simple-maps` + KOSTAT 17-sido GeoJSON), 30 warehouses, 76 lanes, KPI strip, and inline LLM chat panel
- Add Inventory as a first-class Knowledge Graph node — 940 rows, deterministic synthesis with cold-chain awareness; new `Inventory→Warehouse [HELD_AT]` and `Inventory→Product [OF_SKU]` edges
- Add logistics ontology classes — Region (51), Warehouse (30), Carrier (7), Route (76), Shipment (500), Event (12) — with edges `LOCATED_IN`, `OPERATES`, `FULFILLED_BY`, `FROM`/`TO`, `CARRIED_BY`, `VIA`, `CONTAINS`, `AFFECTS_REGION`, `AFFECTS_CATEGORY`
- Add three logistics LLM tools to the chat agent: `inventory_lookup`, `nearest_warehouses` (haversine k-NN), `shortest_path` (BFS over Route edges)
- Add logistics endpoints: `/api/logistics/{network,warehouse/...,events,status,inventory/wh/...,inventory/sku/...,nearest,shortest-path}`
- Add tabbed right panel on `/logistics` (거점·운송사 / 물류 도우미) so the LLM chat is visible by default instead of hidden behind a floating button
- Add Scenario G price/availability compare with four-channel matrix and persona-channel affinity weighting
- Add Manufacturer and Review object explorer types to the Knowledge Graph sidebar
- Add ontology validation report at `/validation` covering INCI/FoodOn/GS1+KFDA/Loader mappings
- Add operations trace viewer at `/ops/trace` with in-process tool-call ring buffer (200 events)
- Add global PersonaSwitch widget in the topbar that auto-injects active persona into search and chat APIs
- Add five-minute guided tour overlay walking through Scenarios A–G on first visit
- Add SSE streaming variant of `/api/search` with phase timeline (guardrail, embed, KNN, BM25, RRF, rerank, subgraph)
- Add SSE streaming variant of `/api/insights` with Sonnet token deltas and phase timeline (Neptune-agg, LLM, Code Interpreter, drilldown)
- Add Korean food ontology hydration (FoodOn → Korean alias map, 219 entries) at `ontology/mappings/foodon-to-korean.json`
- Add Channel→Product `AVAILABLE_IN` edges via deterministic `_assign_channels()` synthesis (CU/eMart/OliveYoung/Kurly)
- Add `/api/auth/whoami`, `/api/auth/login`, `/api/auth/logout` endpoints + sidebar footer login/logout widget
- Add custom domain `retail-ontology.whchoi.net` with ACM `*.whchoi.net` cert and Cognito callback registration

### Changed
- Convert `.claude/agents/*.yml` to `.md` with YAML frontmatter, pin `model: sonnet`, and add explicit `## Output format` section with severity taxonomy + finding shape + termination phrase
- Compact `.claude/settings.local.json` allow list 244 → 75 entries (-69%): consolidated 22 `tee /tmp/*-deploy*.log` paths to `Bash(tee /tmp/*)`, 9 awk one-shots to `Bash(awk *)`, 7 specific dig commands to `Bash(dig *)`, 17 hard-coded ALB/CloudFront curl probes to `Bash(curl -*)`, 12 `cdk deploy --require-approval never` permutations (already denied)
- Tighten `scripts/eval_wow_queries.py` threshold gate — `sys.exit(1)` at <85% pass rate (was warn-only at <70%); matches threshold declared in `.claude/commands/test-all.md`
- Align Conversational Agent UI structure with Search and Insights — input form lifted to top-level, sample chips moved below the form
- Restyle price compare result cards with consistent shading hierarchy (page → card → sub-card)
- Rename ontology relation `Channel → Product STOCKS` to `Product → Channel AVAILABLE_IN` to match loader semantics

### Fixed
- Fix `priceCompare` 500 error caused by passing `parameters` as a positional argument to `neptune.open_cypher`
- Fix `insights/stream` SyntaxError from escaped quotes inside f-string expressions
- Fix INCI validation false negatives by slugifying CSV `inci_name` to match Neptune `inci:<slug>` IDs
- Fix GS1/KFDA validation by filtering Neptune categories to food domain only (beauty bricks are out of scope for the food CSV)
- Fix `boto_session.client(...)` invocation in `/ops/cost` to call the factory function before `.client()`
- Fix dead ADR link in `docs/architecture.md` line 124 (referenced nonexistent `0001-single-image-two-roles.md`); cross-link the four real ADRs
- Fix duplicated `whoami`/`logout` endpoint blocks in `docs/api-reference.md` (cosmetic merge artifact)

### Removed
- Remove cost monitor from the operations sidebar (endpoint retained but not surfaced)

## [0.1.0] - 2026-04-27

### Added
- Add real Lambda@Edge cookie authentication and Cognito callback handler
- Add 30 wow-query evaluation harness with pass-rate scoreboard at `/ops/eval`
- Add CloudTrail management-event logging and ALB access logs
- Add Cost Anomaly subscription on Default-Services-Monitor
- Add Cognito user pool with provisioning script for demo accounts
- Add Bedrock Knowledge Base with hybrid search (BM25 + KNN + Reranker)
- Add AgentCore Memory short-term and long-term namespaces
- Add Code Interpreter sandbox for Korean-glyph matplotlib charts
- Add seven baseline scenarios A–F (semantic search, chat, insights, persona match, safety, substitute) plus knowledge-graph object explorer

### Changed
- **BREAKING:** Switch chat and insights model from Haiku Lite to Sonnet 4.6 across all Bedrock Converse calls
- Cache origin auth secret with five-minute TTL to limit Secrets Manager call volume

### Fixed
- Fix reranker fallback when the cross-region inference profile is unavailable
- Fix AOSS bulk indexing to surface per-document errors and use auto-generated `_id`
- Fix Edge Stack CFN dynamic reference and Neptune `_flatten_props` scalar coercion
- Fix Neptune client to use `boto3.neptunedata` instead of manual SigV4 signing
- Fix JWKS lookup with TTL cache and constant-time origin token comparison
- Fix Neptune IAM action to `neptune-db:*` wildcard (specific actions returned 403)
- Fix CloudTrail subscription to management-event type only

### Security
- Rotate origin shared secret to Secrets Manager and verify Cognito JWTs with RS256
- Wire AuthMiddleware into FastAPI main entry point
- Tighten CORS allow-list and document password rotation policy
- Scope AgentCore Memory IAM to least privilege and relax Cognito password to eight characters for demo accounts
- Remove account-root policy from OpenSearch and use portable cost monitor lookup

[Unreleased]: https://github.com/whchoi98/ontology-retail/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/whchoi98/ontology-retail/releases/tag/v0.1.0

---

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

## [Unreleased]

### Added
- `.github/workflows/ci.yml` 4-job CI 파이프라인 추가 — `python-ast` (compileall), `tsc-check` 매트릭스 [web, infra-cdk], `cdk-synth` + jest 스냅샷, `pytest`. push/PR 트리거 + concurrency cancel-in-progress
- `tests/` pytest 스위트 추가 — 28 tests / <1초: 16 라우터 import smoke (`tests/test_smoke.py`) + 5 Pydantic 모델 검증 + 2 health + 5 `/api/search` 통합 (httpx.AsyncClient + boto3 import-site mock)
- `tests/conftest.py` — collection 시점에 18개 더미 env 설정 + `DEMO_PUBLIC_MODE=true` + `REQUIRE_ORIGIN_AUTH=false`로 ASGI-direct 테스트 가능
- `infra-cdk/test/stacks.test.ts` — 6 CDK 스택 Jest 스냅샷 테스트 (`Template.fromStack().toJSON()`), 결정적 테스트 컨텍스트(account `000000000000`); 7727줄 자동생성 스냅샷
- `requirements-dev.txt` — pytest, pytest-asyncio, httpx (CI 전용, 프로덕션 Docker 이미지에는 미설치)
- `tests/CLAUDE.md` — 테스트 레이아웃, conftest 계층, ASGI fixture, mock-at-import-site 규칙, 스냅샷 업데이트 흐름 문서화
- `docs/decisions/` ADR 4건 추가 — 0001 AgentCore Memory CDK AwsCustomResource, 0002 CloudTrail L1 CfnTrail + manual bucket policy, 0003 Lambda@Edge stable-ID hardcode, 0004 Cognito UserPoolClient CDK-only
- `.claude/settings.json` (프로젝트 공유) — `PreToolUse` + `PostToolUse` + `Stop` 후크 등록 + 60-entry `permissions.deny` (MCP namespace bypass, CloudTrail audit-blinding, AWS IAM 권한 상승 triad 차단)
- `.claude/hooks/scrub-secrets.sh` — Pre/PostToolUse에서 AKIA/ASIA, JWT, PEM private key, Slack token, GitHub PAT 차단
- `.claude/hooks/changelog-reminder.sh` — Stop 시점에 구조적 파일 변경(api/routers, infra-cdk/lib 등)이 있는데 CHANGELOG가 안 바뀌면 알림
- `.claude/skills/{wow-query-eval,cypher-conventions}.md` — 프로젝트 특화 skill 2종
- `.claude/agents/{code-reviewer,security-auditor}.md` — `model: sonnet` 고정, severity taxonomy + finding shape + termination phrase 명시한 `## Output format` 섹션
- 5개 모듈 `CLAUDE.md` git-tracked (api/, web/, data/, infra-cdk/, ontology/) + 루트 `CLAUDE.md`
- `.harness-eval/` 점수 history — 4회 평가 기록 (6.0/C → 5.5/D → 6.9/C → 7.9/B); README 배지 자동 갱신
- 시나리오 H 물류 네트워크 추가 — 한국 시도 choropleth 지도(`react-simple-maps` + KOSTAT 17 시도 GeoJSON), 30 거점, 76 lane, KPI 스트립, 인라인 LLM 챗 패널
- Inventory를 first-class 지식그래프 노드로 추가 — 940 row, cold-chain 인지 결정적 합성, `Inventory→Warehouse [HELD_AT]` + `Inventory→Product [OF_SKU]` 엣지
- 물류 온톨로지 클래스 추가 — Region (51), Warehouse (30), Carrier (7), Route (76), Shipment (500), Event (12) + 엣지 `LOCATED_IN`, `OPERATES`, `FULFILLED_BY`, `FROM`/`TO`, `CARRIED_BY`, `VIA`, `CONTAINS`, `AFFECTS_REGION`, `AFFECTS_CATEGORY`
- 채팅 에이전트에 물류 LLM 도구 3종 추가 — `inventory_lookup`, `nearest_warehouses` (haversine k-NN), `shortest_path` (Route 엣지 위 BFS)
- 물류 엔드포인트 추가 — `/api/logistics/{network,warehouse/...,events,status,inventory/wh/...,inventory/sku/...,nearest,shortest-path}`
- `/logistics` 우측 패널을 탭(거점·운송사 / 물류 도우미)으로 재구성 — LLM 챗을 floating에서 always-visible 인라인으로 전환
- 시나리오 G 가격·가용성 비교 추가 — 4채널 매트릭스 + 페르소나-채널 친화도 가중치
- 지식그래프 사이드바에 Manufacturer, Review 객체 탐색 타입 추가
- `/validation` 매핑 검증 리포트 추가 — INCI/FoodOn/GS1+KFDA/Loader 커버리지
- `/ops/trace` 운영 트레이스 뷰어 추가 — in-process 도구 호출 ring buffer 200건
- 우상단 PersonaSwitch 전역 위젯 추가 — 활성 페르소나를 search/chat API에 자동 주입
- 첫 방문 시 자동 노출되는 5분 가이드 투어 오버레이 추가 — 시나리오 A–G 안내
- `/api/search`의 SSE 스트리밍 변형 추가 — phase 타임라인(guardrail, embed, KNN, BM25, RRF, rerank, subgraph)
- `/api/insights`의 SSE 스트리밍 변형 추가 — Sonnet 토큰 delta + phase 타임라인(Neptune-agg, LLM, Code Interpreter, drilldown)
- 한국 식품 온톨로지 보충 — `ontology/mappings/foodon-to-korean.json` 219건 한글 별칭
- 결정적 `_assign_channels()` 합성으로 Channel→Product `AVAILABLE_IN` 엣지 적재 (CU/이마트/올리브영/마컬)
- `/api/auth/whoami`, `/api/auth/login`, `/api/auth/logout` 엔드포인트 + 사이드바 하단 로그인/아웃 위젯 추가
- 커스텀 도메인 `retail-ontology.whchoi.net` 연결 — ACM `*.whchoi.net` 인증서, Cognito 콜백 등록

### Changed
- `.claude/agents/*.yml` → `.md` 변환 + YAML frontmatter, `model: sonnet` 고정, severity taxonomy + finding shape + termination phrase 포함된 `## Output format` 섹션 추가
- `.claude/settings.local.json` allow list 244 → 75 (-69%) 컴팩션 — `tee /tmp/*-deploy*.log` 22개 → `Bash(tee /tmp/*)`, awk 1회성 9개 → `Bash(awk *)`, dig 7개 → `Bash(dig *)`, 하드코딩 ALB/CloudFront curl 17개 → `Bash(curl -*)`, `cdk deploy --require-approval never` 12개 (이미 deny 처리)
- `scripts/eval_wow_queries.py` 임계값 게이트 강화 — <85% pass-rate에서 `sys.exit(1)` (이전: <70%에서 warn-only); `.claude/commands/test-all.md`의 임계값과 일치
- 대화형 에이전트 UI 구조를 의미 검색·MD 인사이트와 통일 — 입력 폼을 최상단으로, 샘플 풍선을 폼 하단으로 이동
- 가격 비교 결과 카드 음영 계층 정리 (페이지 → 카드 → 서브카드)
- 온톨로지 관계 `Channel → Product STOCKS`를 로더 의미에 맞게 `Product → Channel AVAILABLE_IN`로 변경

### Fixed
- `neptune.open_cypher`에 `parameters`를 positional로 넘겨 발생한 priceCompare 500 오류 수정
- `insights/stream` f-string 표현식 내부 escaped 따옴표 SyntaxError 수정
- INCI 검증 false-negative 수정 — CSV `inci_name`을 slug 변환해 Neptune `inci:<slug>` ID와 동일 형식으로 비교
- GS1/KFDA 검증을 식품 도메인 카테고리만 검사하도록 필터 추가 (뷰티 brick은 식품 CSV 범위 외)
- `/ops/cost`의 `boto_session.client(...)` 호출을 `boto_session().client(...)`로 수정
- `docs/architecture.md` 124 라인 dead ADR link 수정 (존재하지 않는 `0001-single-image-two-roles.md` 참조 제거); 실제 4개 ADR 교차 링크 추가
- `docs/api-reference.md` `whoami`/`logout` 중복 블록 제거 (병합 잔재)

### Removed
- 운영 사이드바에서 비용 모니터 제거 (endpoint는 유지하되 노출하지 않음)

## [0.1.0] - 2026-04-27

### Added
- 실제 Lambda@Edge 쿠키 인증 및 Cognito 콜백 핸들러 추가
- `/ops/eval`에 30개 wow 쿼리 평가 하네스와 pass-rate 스코어보드 추가
- CloudTrail 관리 이벤트 로깅과 ALB 액세스 로그 추가
- Default-Services-Monitor에 Cost Anomaly 구독 추가
- 데모 계정 프로비저닝 스크립트와 함께 Cognito 사용자 풀 추가
- 하이브리드 검색(BM25 + KNN + Reranker)을 갖춘 Bedrock Knowledge Base 추가
- AgentCore Memory short-term, long-term 네임스페이스 추가
- 한글 폰트 matplotlib 차트를 위한 Code Interpreter 샌드박스 추가
- 시나리오 A–F(의미 검색, 채팅, 인사이트, 페르소나 매칭, 안전성, 대체재) 베이스라인 7종 + 지식그래프 객체 탐색기 추가

### Changed
- **BREAKING:** 모든 Bedrock Converse 호출의 채팅·인사이트 모델을 Haiku Lite에서 Sonnet 4.6으로 변경
- Secrets Manager 호출량 절감을 위해 origin auth secret을 5분 TTL로 캐시

### Fixed
- 리랭커 cross-region inference profile 비가용 시 fallback 처리 수정
- AOSS bulk indexing이 문서별 오류를 표면화하고 자동 생성 `_id`를 사용하도록 수정
- Edge Stack CFN dynamic reference 및 Neptune `_flatten_props` 스칼라 강제 변환 수정
- Neptune 클라이언트를 수동 SigV4 서명 대신 `boto3.neptunedata`로 변경
- JWKS 조회에 TTL 캐시 적용 및 origin 토큰을 상수 시간 비교로 수정
- Neptune IAM 액션을 `neptune-db:*` 와일드카드로 수정 (개별 액션은 403 반환)
- CloudTrail 구독을 management 이벤트 타입에 한정하도록 수정

### Security
- Origin 공유 비밀을 Secrets Manager로 회전하고 Cognito JWT는 RS256으로 검증
- AuthMiddleware를 FastAPI 메인 엔트리에 연결
- CORS 허용 목록 강화 및 비밀번호 회전 정책 문서화
- AgentCore Memory IAM을 최소 권한으로 좁히고 데모 계정 Cognito 비밀번호를 8자로 완화
- OpenSearch에서 계정 root 정책 제거 및 portable cost monitor 조회로 변경

[Unreleased]: https://github.com/whchoi98/ontology-retail/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/whchoi98/ontology-retail/releases/tag/v0.1.0
