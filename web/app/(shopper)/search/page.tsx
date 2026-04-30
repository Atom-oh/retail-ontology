'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

import * as api from '@/lib/api-client';

// Cytoscape imports browser-only globals; load client-side only.
const CytoscapeView = dynamic(
  () => import('@/components/graph/CytoscapeView').then((m) => m.CytoscapeView),
  { ssr: false },
);

const WOW_QUERIES = [
  '여름철 민감성 피부에 좋은 선크림 추천해줘',
  '글루텐프리 4세 아이 간식, 100칼로리 이하',
  '임산부도 사용 가능한 비건 화장품',
  '20대 여드름성 피부 토너',
  '캠핑갈 때 필요한 간편식',
];

// Human-readable label + tone for each phase emitted by /api/search/stream.
// Keeps page logic generic while the API can add/rename phases without UI changes.
const PHASE_META: Record<string, { label: string; tone: string }> = {
  bm25:    { label: 'BM25 (Nori 한글)',         tone: 'border-blue-500/40    bg-blue-500/10    text-blue-200' },
  knn:     { label: 'Cohere embed-v4 KNN',       tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  rrf:     { label: 'RRF fusion',                tone: 'border-amber-500/40   bg-amber-500/10   text-amber-200' },
  rerank:  { label: 'Bedrock rerank-v3',         tone: 'border-violet-500/40  bg-violet-500/10  text-violet-200' },
  error:   { label: '오류',                      tone: 'border-rose-500/40    bg-rose-500/10    text-rose-200' },
};

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.SearchResponse | null>(null);
  const [phases, setPhases] = useState<api.SearchPhase[]>([]);

  async function runSearch(query: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    setPhases([]);
    setQ(query);
    try {
      await api.searchStream(
        { q: query, topK: 10 },
        (event) => {
          if (event.type === 'phase') {
            setPhases((p) => [...p, event.data]);
          } else if (event.type === 'result') {
            setResult(event.data);
          }
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold mb-1">시나리오 A · 의미 검색</h1>
      <p className="text-sm text-slate-500 mb-6">
        한국어 자연어 쿼리 → OpenSearch BM25(Nori) + Cohere KNN 하이브리드 → Bedrock Reranker.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) runSearch(q.trim()); }}
        className="flex gap-2 mb-4"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="자연어 쿼리를 입력하세요"
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="submit"
          disabled={loading || !q.trim()}
          className="px-5 py-2 rounded-lg bg-brand-600 text-white disabled:bg-slate-300 hover:bg-brand-500 transition"
        >
          {loading ? '검색 중…' : '검색'}
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mb-6">
        {WOW_QUERIES.map((qq) => (
          <button
            key={qq}
            onClick={() => { setQ(qq); runSearch(qq); }}
            className="text-xs px-3 py-1 rounded-full border border-slate-300 dark:border-slate-700 hover:border-brand-500 hover:text-brand-600 transition"
          >
            {qq}
          </button>
        ))}
      </div>

      {/* Streaming phase progress — visible while the API streams phase
          events. Disappears once the result event arrives. */}
      {(loading || phases.length > 0) && !result && (
        <div className="mb-6 rounded-lg border border-slate-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-ink-400 font-semibold mb-2 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse-soft" />
            검색 파이프라인 진행 중 — {phases.length}단계 완료
          </div>
          <ol className="flex flex-wrap items-center gap-2">
            {phases.map((p, i) => {
              const meta = PHASE_META[p.name] ?? { label: p.name, tone: 'border-slate-500/40 bg-slate-500/10 text-slate-200' };
              return (
                <li
                  key={i}
                  className={`flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border ${meta.tone}`}
                >
                  <span className="text-[9px] opacity-60">{i + 1}.</span>
                  <span className="font-semibold">{meta.label}</span>
                  {p.detail && <span className="opacity-70">— {p.detail}</span>}
                  {typeof p.ms === 'number' && <span className="opacity-50">·{p.ms}ms</span>}
                </li>
              );
            })}
            {loading && (
              <li className="text-[11px] font-mono px-2 py-1 rounded border border-slate-300/30 bg-slate-300/5 text-slate-400 animate-pulse-soft">
                다음 단계…
              </li>
            )}
          </ol>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-sm">
          오류: {error}
        </div>
      )}

      {result && (
        <div className="grid lg:grid-cols-2 gap-6">
          <section>
            <h2 className="text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
              결과 ({result.hits.length})
            </h2>
            <ul className="space-y-3">
              {result.hits.map((h, i) => (
                <li
                  key={`${h.sku_id}-${i}`}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-mono text-xs text-slate-500">{h.sku_id}</span>
                    <span className="text-xs text-brand-600">score {h.score.toFixed(3)}</span>
                  </div>
                  <p className="text-sm leading-relaxed line-clamp-3">{h.text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
              온톨로지 그래프 ({result.subgraph.nodes.length} nodes / {result.subgraph.edges.length} edges)
            </h2>
            <CytoscapeView
              subgraph={result.subgraph}
              wowNodeIds={result.hits.slice(0, 3).map((h) => h.sku_id)}
              height={520}
            />
          </section>
        </div>
      )}
    </div>
  );
}
