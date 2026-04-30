import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <p className="text-sm tracking-wide text-brand-600 mb-2">
          Korean Retail / CPG 영업 데모
        </p>
        <h1 className="text-4xl font-bold leading-tight">
          편의점·드럭스토어·뷰티 코어 데이터를
          <br />
          온톨로지 + AWS Bedrock으로 풀어내는 11개 wow 시나리오
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          좌측 사이드바에서 페르소나를 정한 뒤, 아래 카드 또는 5분 가이드 투어로 진입하세요.
        </p>
      </header>

      <Section title="쇼퍼 + MD 시나리오 (A–H)">
        <ScenarioCard href="/search"     tag="A" title="의미 검색"        desc="자연어 쿼리 → BM25 + Cohere KNN + Bedrock rerank + 1-hop 그래프"        accent="from-sky-500 to-indigo-500" />
        <ScenarioCard href="/chat"       tag="B" title="대화형 에이전트"    desc="Bedrock Converse + AgentCore Memory + 4 도구 호출 SSE 스트리밍"           accent="from-emerald-500 to-teal-500" />
        <ScenarioCard href="/insights"   tag="C" title="MD 인사이트"       desc="자연어 BI → Code Interpreter 차트 + 1-hop 드릴다운"                       accent="from-orange-500 to-rose-500" />
        <ScenarioCard href="/match"      tag="D" title="페르소나 매칭"     desc="40 페르소나 × HAS_CONCERN 그래프 워크로 SKU 추천"                          accent="from-violet-500 to-purple-500" />
        <ScenarioCard href="/safety"     tag="E" title="안전성 렌즈"       desc="Safety Profile × AVOIDS_INGREDIENT → 위반 SKU 자동 표시"                  accent="from-rose-500 to-red-500" />
        <ScenarioCard href="/substitute" tag="F" title="대체재 추천"       desc="동일 카테고리·효능 다른 브랜드 + 가격 차이 비교"                          accent="from-cyan-500 to-sky-500" />
        <ScenarioCard href="/price"      tag="G" title="가격·가용성"       desc="이마트·올영·CU·마컬 4채널 가격/할인/재고 매트릭스"                       accent="from-cyan-500 to-emerald-500" />
        <ScenarioCard href="/logistics"  tag="H" title="물류 네트워크"     desc="한국 sido choropleth + 30 창고 + 운송 lane + 출하 KPI"                    accent="from-teal-500 to-cyan-500" />
      </Section>

      <Section title="멤버십·마케팅 시나리오 (I–K) — 신규">
        <ScenarioCard href="/churn"       tag="I" title="이탈 위험 진단"  desc="RFM 기반 churn_risk + VIP/Gold 분포 + 페르소나 맞춤 winback 추천"          accent="from-orange-500 to-amber-500" />
        <ScenarioCard href="/acquisition" tag="J" title="확보 채널 ROI"   desc="Campaign × Channel × Persona 매트릭스 — 카카오 vs 이메일 비교"             accent="from-fuchsia-500 to-pink-500" />
        <ScenarioCard href="/tier-up"     tag="K" title="등급 상승 경로"  desc="Silver→Gold lift + LTV ≥1.5M 업그레이드 후보 추출"                         accent="from-yellow-500 to-amber-500" />
      </Section>

      <Section title="메타 / 운영">
        <ScenarioCard href="/objects/member" tag="객체" title="Knowledge Graph 탐색"   desc="회원·상품·성분·캠페인 등 16종 노드 타입 + 1-hop 시각화"                accent="from-slate-500 to-slate-700" />
        <ScenarioCard href="/schema"     tag="ER"   title="온톨로지 스키마"  desc="24 클래스 + 35 관계 ER 다이어그램 (Neptune 라이브 카운트 포함)"            accent="from-slate-500 to-slate-700" />
        <ScenarioCard href="/standards"  tag="표준" title="표준 매핑 브라우저" desc="GS1·FoodOn·INCI 매핑 CSV 라이브 조회"                                      accent="from-slate-500 to-slate-700" />
        <ScenarioCard href="/validation" tag="검증" title="매핑 검증 리포트"  desc="외부 표준 ↔ Neptune 그래프 커버리지 % + 누락 ID 샘플"                       accent="from-slate-500 to-slate-700" />
        <ScenarioCard href="/ops/ingest" tag="Ops"  title="운영 콘솔"       desc="Neptune 적재 / 가드레일 / 메모리 / 평가 / 트레이스"                        accent="from-slate-500 to-slate-700" />
      </Section>

      <footer className="mt-12 text-xs text-slate-400">
        <p>
          본 데모의 SKU·리뷰·페르소나·회원·캠페인은 합성 데이터입니다. 공공 표준
          (GS1 GPC, FoodOn, INCI, schema.org) + 식약처 한국 어댑터 매핑.
        </p>
      </footer>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase mb-3">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function ScenarioCard({
  href, tag, title, desc, accent,
}: { href: string; tag: string; title: string; desc: string; accent: string }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 hover:shadow-lg hover:border-brand-400/40 transition"
    >
      <div className={`inline-block bg-gradient-to-r ${accent} bg-clip-text text-transparent text-[10px] font-mono font-semibold tracking-wide mb-1.5`}>
        시나리오 {tag}
      </div>
      <h3 className="text-base font-bold mb-1 group-hover:text-brand-600 transition">{title}</h3>
      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">{desc}</p>
      <div className="mt-3 text-xs text-brand-600 group-hover:translate-x-1 transition">
        진입 →
      </div>
    </Link>
  );
}
