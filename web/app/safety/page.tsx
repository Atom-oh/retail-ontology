'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ShieldCheck, ShieldAlert, Sparkles, Search as SearchIcon } from 'lucide-react';

import * as api from '@/lib/api-client';

const CytoscapeView = dynamic(
  () => import('@/components/graph/CytoscapeView').then((m) => m.CytoscapeView),
  { ssr: false },
);

const SAMPLE_QUERIES = [
  '임산부가 사용해도 안전한 화장품',
  '4세 아이가 먹어도 되는 글루텐프리 간식',
  '비건 라이프스타일 위반 제품 검사',
  '민감성 피부에 위험한 성분 함유 제품',
  '당뇨 관리에 부적합한 고당류 제품',
];

export default function SafetyPage() {
  const [profiles, setProfiles] = useState<api.SafetyProfile[]>([]);
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState<'beauty' | 'grocery' | ''>('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [result, setResult] = useState<api.SafetyCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSafetyProfiles().then((r) => setProfiles(r.items)).catch((e) => setError(String(e)));
  }, []);

  async function run(input: { profile_id?: string; q?: string }) {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await api.safetyCheck({ ...input, domain: domain || undefined, top_k: 12 });
      setResult(r);
      setProfileId(r.profile_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">시나리오 E · 안전성 렌즈</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30">
          Audience profile → AVOIDS_INGREDIENT → 위반 highlight
        </span>
      </header>

      <div className="flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-50 mb-1 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-rose-400" /> 안전성 렌즈
          </h1>
          <p className="text-sm text-ink-400">
            대상자 프로필(임산부 / 4세 아이 / 글루텐프리 / 비건 / 민감성 피부 / 당뇨)을 선택하거나 자연어로 질문하세요.
            Concern → AVOIDS_INGREDIENT 그래프를 따라 위반 제품을 자동 표시합니다.
          </p>
        </div>

        {/* Domain filter — narrows safety check to beauty or grocery */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-400">도메인 필터:</span>
          {[
            { v: '',        ko: '전체',    cls: 'border-ink-700 text-ink-300' },
            { v: 'beauty',  ko: '화장품',  cls: 'border-blue-500/50 text-blue-300' },
            { v: 'grocery', ko: '식품',    cls: 'border-emerald-500/50 text-emerald-300' },
          ].map((d) => (
            <button key={d.v}
              onClick={() => setDomain(d.v as '' | 'beauty' | 'grocery')}
              className={[
                'text-xs px-3 py-1 rounded-full border transition',
                domain === d.v
                  ? 'bg-rose-500/20 text-rose-200 border-rose-500/60 font-semibold'
                  : `bg-ink-800 ${d.cls} hover:border-rose-500/60`,
              ].join(' ')}>{d.ko}</button>
          ))}
          <span className="text-[10px] text-ink-500 ml-1">
            (자연어 입력 시 자동 감지: &ldquo;화장품&rdquo; / &ldquo;간식&rdquo; 등)
          </span>
        </div>

        {/* Profile chips */}
        <div className="flex flex-wrap gap-2">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => run({ profile_id: p.id })}
              className={[
                'text-xs px-3 py-1.5 rounded-full border transition',
                profileId === p.id
                  ? 'bg-rose-500/20 text-rose-200 border-rose-500/60'
                  : 'border-ink-700 bg-ink-800 text-ink-300 hover:border-rose-500/60 hover:text-rose-300',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* NL query */}
        <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) run({ q: q.trim() }); }} className="flex gap-2">
          <div className="flex-1 relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="자연어로 질문 (예: 임산부 안전 화장품)"
              className="w-full rounded-md border border-ink-700 bg-ink-900 text-ink-100 pl-9 pr-4 py-2.5 outline-none focus:border-rose-500 placeholder:text-ink-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="px-5 py-2.5 rounded-md bg-rose-500 text-ink-950 font-semibold disabled:bg-ink-700 disabled:text-ink-500 hover:bg-rose-400 transition"
          >
            {loading ? '분석 중…' : '검사'}
          </button>
        </form>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-ink-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" /> 샘플:
          </span>
          {SAMPLE_QUERIES.map((qq) => (
            <button
              key={qq}
              onClick={() => { setQ(qq); run({ q: qq }); }}
              className="text-xs px-3 py-1 rounded-full border border-ink-700 bg-ink-800 text-ink-300 hover:border-rose-500/60 hover:text-rose-300 transition"
            >
              {qq}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-sm">{error}</div>
        )}

        {result && (
          <div className="grid xl:grid-cols-[1fr_1fr] gap-5 flex-1 min-h-0">
            <div className="space-y-4 overflow-y-auto pr-2">
              {/* Profile summary */}
              <article className="p-5 rounded-lg border border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-rose-500/0">
                <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold mb-1">
                  Audience profile
                </div>
                <h2 className="text-lg font-bold text-ink-50">{result.profile_label}</h2>
                <p className="text-sm text-ink-300 leading-relaxed mt-1">{result.profile_desc}</p>
                <div className="text-[11px] text-ink-300 mt-3">{result.summary_ko}</div>
                {result.matched_concerns.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {result.matched_concerns.map((c, i) => (
                      <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-ink-800 text-ink-200 border border-ink-700">
                        {String(c.name_ko ?? c.concern_id)}
                      </span>
                    ))}
                  </div>
                )}
              </article>

              {/* Safe products */}
              <article>
                <h3 className="text-sm font-semibold text-ink-100 mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" /> 안전 후보 ({result.safe.length})
                </h3>
                <ul className="space-y-1.5">
                  {result.safe.map((p) => (
                    <li key={p.sku_id} className="px-3 py-2 rounded border border-emerald-500/20 bg-emerald-500/5 text-sm text-ink-100 flex items-start justify-between gap-3">
                      <span className="line-clamp-1">{p.name}</span>
                      <span className="text-[10px] font-mono text-emerald-300 shrink-0">{p.score}</span>
                    </li>
                  ))}
                </ul>
              </article>

              {/* Violators */}
              <article>
                <h3 className="text-sm font-semibold text-ink-100 mb-2 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-rose-400" /> 위반 후보 ({result.violating.length})
                </h3>
                <ul className="space-y-1.5">
                  {result.violating.map((p) => (
                    <li key={p.sku_id} className="px-3 py-2 rounded border border-rose-500/30 bg-rose-500/5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm text-ink-100 line-clamp-1">{p.name}</span>
                        <span className="text-[10px] font-mono text-rose-300 shrink-0">{p.score}</span>
                      </div>
                      <div className="text-[10px] font-mono text-rose-300 mt-1 truncate">
                        {p.violations.slice(0, 5).join(', ')}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <section className="min-h-[600px] xl:min-h-0">
              <CytoscapeView subgraph={result.subgraph} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
