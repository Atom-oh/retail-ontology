import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-12">
        <p className="text-sm tracking-wide text-brand-600 mb-2">
          Korean Retail / CPG 영업 데모
        </p>
        <h1 className="text-4xl font-bold leading-tight">
          편의점·드럭스토어·뷰티 코어 데이터를
          <br />
          온톨로지 + AWS Bedrock으로 풀어내는 검색·에이전트·MD 인사이트
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          페르소나를 선택해 시나리오 A/B/C 중 하나로 진입하세요.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <PersonaCard
          href="/search"
          tag="시나리오 A"
          title="의미 검색"
          desc="여름철 민감성 피부 선크림 같은 한국어 자연어 쿼리를 온톨로지 그래프 위에서 풀어냅니다."
          accent="from-sky-500 to-indigo-500"
        />
        <PersonaCard
          href="/chat"
          tag="시나리오 B"
          title="대화형 에이전트"
          desc="Bedrock + AgentCore Memory가 임산부·캠핑·헬스 컨텍스트를 다회차로 추적합니다."
          accent="from-emerald-500 to-teal-500"
        />
        <PersonaCard
          href="/insights"
          tag="시나리오 C"
          title="MD 인사이트"
          desc="20대 여성 검색 폭증 성분 같은 자연어 BI 쿼리를 차트로 즉석 생성합니다."
          accent="from-orange-500 to-rose-500"
        />
      </section>

      <footer className="mt-16 text-xs text-slate-400">
        <p>
          본 데모의 SKU·리뷰·페르소나는 합성 데이터입니다. 공공 표준
          (GS1 GPC, FoodOn, INCI, schema.org) + 식약처 한국 어댑터 매핑.
        </p>
      </footer>
    </main>
  );
}

function PersonaCard({
  href, tag, title, desc, accent,
}: { href: string; tag: string; title: string; desc: string; accent: string }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 hover:shadow-lg transition"
    >
      <div className={`inline-block bg-gradient-to-r ${accent} bg-clip-text text-transparent text-xs font-semibold tracking-wide mb-2`}>
        {tag}
      </div>
      <h2 className="text-xl font-bold mb-2 group-hover:text-brand-600 transition">{title}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{desc}</p>
      <div className="mt-4 text-sm text-brand-600 group-hover:translate-x-1 transition">
        진입 →
      </div>
    </Link>
  );
}
