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

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.SearchResponse | null>(null);

  async function runSearch(query: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.search(query, { topK: 10 });
      setResult(res);
      setQ(query);
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
