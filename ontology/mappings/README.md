# Ontology Mappings — Standard ↔ Korean Adapters

Phase 0 산출물. 영업 데모용 250 SKU(그로서리 125 + 뷰티 125)를 위한 표준-한국 매핑 시트.

## Files

| File | Purpose | Rows | Source standards |
|---|---|---|---|
| `gs1-gpc-to-kfda-food.csv` | GS1 GPC Brick → 식약처 식품유형 | ~40 | GS1 GPC, 식약처 식품공전 |
| `inci-to-korean.csv` | INCI → 식약처 화장품 한글성분 | ~80 | INCI, 식약처 화장품성분사전 |

## Methodology (Claude 1차 → 인간 검수)

1. **1차 생성 (이 커밋, Claude)**: 한국 편의점·마트·올리브영 시연에 등장할 가능성이 높은 카테고리·성분을 우선 선정하여 1차 매핑 작성.
2. **검수 (인간, 후속 커밋)**: 다음 권위 있는 소스로 코드/명칭 검증:
   - GS1 GPC Browser: https://gpc-browser.gs1.org/
   - 식품의약품안전처 식품안전나라 식품공전: https://various.foodsafetykorea.go.kr/fsd/
   - 식약처 의약품안전나라 화장품 성분사전: https://nedrug.mfds.go.kr/
   - INCI Beauty: https://incibeauty.com/
3. **반영**: 수정사항을 CSV에 직접 반영, `verified` 컬럼을 `Y`로 전환. 시연 시점 v1.0 동결.

## Caveats — 검수 전 주의

- **GS1 GPC 8자리 코드**와 **식약처 식품유형 명칭**은 Claude의 추정값을 포함합니다. 카테고리 의미와 한국 매핑은 도메인 의미 기반으로 정확하나, **8자리 코드 자체는 검수 전 신뢰하지 말 것**.
- INCI 한글명은 식약처 화장품성분사전의 표준명을 따르려 했으나, 일부는 업계 표기 변형이 있을 수 있습니다(예: `애씨드` vs `산`).
- 시연 wow 모멘트(예: "민감성 피부 선크림", "글루텐프리 4세 간식")용 한국어 일상 표현은 `synonyms_ko` 컬럼에 우선 수록.
- 본 매핑은 **데모 범위(250 SKU)**를 커버합니다. Real Data PoC 단계에서 확장 필요.

## Schema

### gs1-gpc-to-kfda-food.csv

| Column | Description |
|---|---|
| `gs1_brick_code` | GS1 GPC Brick 8자리 코드 (검증 필요) |
| `gs1_brick_name_en` | GS1 GPC 영문 Brick 명 |
| `kfda_category_path` | 식약처 식품유형 경로 (예: `과자류 > 스낵과자`) |
| `retail_category_ko` | 한국 편의점/마트에서 쓰이는 친숙한 카테고리명 (UI 표시용) |
| `synonyms_ko` | 검색·대화에 쓰일 한국어 시노님 (`;` 구분) |
| `domain` | `beverage` / `dairy` / `snack` / `bakery` / `instant` / `frozen` / `condiment` / `grocery` / `health` / `baby` |
| `demo_sku_examples` | 데모 SKU 예시 (1-3개, 합성/실제 브랜드 혼합) |
| `verified` | `Y`/`N` — 인간 검수 완료 여부 (초기값 `N`) |
| `notes` | 검수 메모 / 우려 사항 |

### inci-to-korean.csv

| Column | Description |
|---|---|
| `inci_name` | INCI 영문 표기 (대소문자 표준) |
| `korean_name` | 식약처 화장품성분사전 한글명 (검증 필요) |
| `synonyms_ko` | 검색·대화에 쓰일 한국어 친숙 표현 (`;` 구분) |
| `function_ko` | 효능 범주: `보습`/`미백`/`주름개선`/`진정`/`항산화`/`각질제거`/`세정`/`자외선차단`/`방부`/`기타` |
| `concerns_ko` | 다루는 피부 고민 (`;` 구분, 예: `민감성;여드름;각질`) |
| `regulatory_class` | `미백고시` / `주름개선고시` / `자외선차단성분` / `일반` 등 (식약처 기준) |
| `wow_moment` | `Y`/`N` — 시연 wow 시나리오 핵심 성분 여부 (8.6 §) |
| `verified` | `Y`/`N` — 인간 검수 완료 여부 (초기값 `N`) |
| `notes` | 검수 메모 / 우려 사항 |

## Versioning

- **v0.1** (현재): Claude 1차 생성, 검수 전.
- **v0.2** (예정): 인간 검수 1회, `verified=Y` 비율 ≥80%.
- **v1.0** (시연 동결): 30 wow 쿼리 검증 통과 후 동결.
