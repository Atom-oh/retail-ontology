'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Users, Sparkles, ShieldAlert, ShieldCheck, ChevronRight, Search as SearchIcon } from 'lucide-react';

import * as api from '@/lib/api-client';

const CytoscapeView = dynamic(
  () => import('@/components/graph/CytoscapeView').then((m) => m.CytoscapeView),
  { ssr: false },
);

export default function PersonaMatchPage() {
  const [personas, setPersonas] = useState<api.PersonaListItem[] | null>(null);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<api.PersonaMatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listPersonas(60).then((r) => setPersonas(r.items)).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true); setError(null); setResult(null);
    api.personaMatch(selectedId, 10)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const filteredPersonas = useMemo(() => {
    if (!personas) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return personas;
    return personas.filter((p) =>
      p.label_ko.toLowerCase().includes(f)
      || (p.life_stage_ko ?? '').toLowerCase().includes(f)
      || (p.narrative_ko ?? '').toLowerCase().includes(f),
    );
  }, [personas, filter]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">시나리오 D · 페르소나 매칭</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/30">
          Persona → Concerns → Avoided/Preferred → Products
        </span>
      </header>

      <div className="flex-1 grid xl:grid-cols-[340px_1fr_360px] min-h-0">
        {/* List pane: persona picker */}
        <aside className="border-r border-ink-700 bg-ink-900 flex flex-col min-h-0">
          <div className="p-4 border-b border-ink-700">
            <h2 className="text-sm font-semibold text-ink-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-400" /> 페르소나 ({personas?.length ?? '…'})
            </h2>
            <p className="text-[10px] text-ink-400 mt-1 leading-relaxed">
              합성 페르소나 40명 — 임산부·캠퍼·헬스챌린저·셀리악 워킹맘 등
            </p>
          </div>
          <div className="px-3 py-2 border-b border-ink-700 relative">
            <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-500" />
            <input
              value={filter} onChange={(e) => setFilter(e.target.value)}
              placeholder="페르소나 필터"
              className="w-full rounded bg-ink-800 border border-ink-700 text-xs pl-8 pr-3 py-1.5 text-ink-100 outline-none focus:border-violet-500 placeholder:text-ink-500"
            />
          </div>
          <ul className="flex-1 overflow-y-auto">
            {!personas && <li className="text-xs text-ink-500 italic p-4">로딩 중…</li>}
            {filteredPersonas.map((p) => {
              const active = p.persona_id === selectedId;
              return (
                <li key={p.persona_id}>
                  <button
                    onClick={() => setSelectedId(p.persona_id)}
                    className={[
                      'w-full text-left px-4 py-2.5 border-b border-ink-700/40 transition',
                      active ? 'bg-violet-500/10 border-l-2 border-l-violet-500' : 'hover:bg-ink-800',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-1">
                      <div className={`text-sm font-medium truncate ${active ? 'text-violet-200' : 'text-ink-100'}`}>
                        {p.label_ko}
                      </div>
                      {p.is_wow && (
                        <Sparkles className="w-3 h-3 text-violet-300 shrink-0 mt-0.5" />
                      )}
                    </div>
                    <div className="text-[10px] text-ink-400 truncate mt-0.5">
                      {p.age && `${p.age}세 ·`} {p.life_stage_ko ?? ''} · concerns {p.concern_count}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Center: header + recommendations + warnings */}
        <section className="flex flex-col min-h-0 overflow-y-auto">
          <div className="px-6 py-5">
            <h1 className="text-2xl font-bold text-ink-50 mb-1 flex items-center gap-2">
              <Users className="w-6 h-6 text-violet-400" /> 페르소나 매칭
            </h1>
            <p className="text-sm text-ink-400">
              페르소나가 가진 Concern → 선호/회피 성분 → 제품 매칭. 위반 제품은 따로 표시됩니다.
            </p>
          </div>

          {error && (
            <div className="mx-6 mb-4 p-3 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-sm">
              {error}
            </div>
          )}
          {loading && <div className="mx-6 text-sm text-ink-400">분석 중…</div>}

          {result && (
            <div className="px-6 pb-6 space-y-5">
              {/* Persona profile card */}
              <article className="p-5 rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-violet-500/0">
                <div className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold mb-1">
                  Persona profile
                </div>
                <h2 className="text-lg font-bold text-ink-50">{String(result.persona.label_ko ?? '')}</h2>
                <p className="text-sm text-ink-300 leading-relaxed mt-1.5">
                  {String(result.persona.narrative_ko ?? '')}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {result.concerns.map((c, i) => (
                    <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-ink-800 text-ink-200 border border-ink-700">
                      {String(c.name_ko ?? c.concern_id)}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                  <div>
                    <div className="text-ink-400 mb-1">선호 성분 ({result.preferred_ingredients.length})</div>
                    <div className="text-ink-200 font-mono text-[10px] leading-snug truncate">
                      {result.preferred_ingredients.slice(0, 6).join(', ') || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-400 mb-1">회피 성분 ({result.avoided_ingredients.length})</div>
                    <div className="text-rose-300 font-mono text-[10px] leading-snug truncate">
                      {result.avoided_ingredients.slice(0, 6).join(', ') || '—'}
                    </div>
                  </div>
                </div>
              </article>

              {/* Recommendations */}
              <article>
                <h3 className="text-sm font-semibold text-ink-100 mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  추천 제품 ({result.recommendations.length})
                </h3>
                <ul className="grid sm:grid-cols-2 gap-2">
                  {result.recommendations.map((p) => (
                    <li key={p.sku_id} className="p-3 rounded-md border border-ink-700 bg-ink-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono text-ink-500">{p.sku_id}</span>
                        <span className="text-[10px] font-mono text-emerald-300">+{p.score}</span>
                      </div>
                      <div className="text-sm text-ink-100 line-clamp-2">{p.name}</div>
                      <div className="text-[10px] text-ink-400 mt-1">
                        concerns +{p.concern_match} · prefer +{p.prefer_score}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <article>
                  <h3 className="text-sm font-semibold text-ink-100 mb-2 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    안전 경고 ({result.warnings.length})
                  </h3>
                  <ul className="grid sm:grid-cols-2 gap-2">
                    {result.warnings.map((p) => (
                      <li key={p.sku_id} className="p-3 rounded-md border border-rose-500/30 bg-rose-500/5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-ink-500">{p.sku_id}</span>
                          <span className="text-[10px] font-mono text-rose-300">위반 {p.violation_count}</span>
                        </div>
                        <div className="text-sm text-ink-100 line-clamp-2">{p.name}</div>
                        <div className="text-[10px] text-rose-300 mt-1 truncate font-mono">
                          {p.violations.slice(0, 5).join(', ')}
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              )}
            </div>
          )}
          {!result && !loading && !error && (
            <div className="flex-1 flex items-center justify-center text-sm text-ink-500 italic px-6 text-center">
              좌측 페르소나를 클릭하면 매칭 결과가 표시됩니다.
            </div>
          )}
        </section>

        {/* Right: graph */}
        <aside className="border-l border-ink-700 bg-ink-900 p-3 min-h-[400px] xl:min-h-0">
          {result ? (
            <CytoscapeView subgraph={result.subgraph} />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-ink-500 italic">
              그래프
              <ChevronRight className="w-3 h-3 ml-1" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
