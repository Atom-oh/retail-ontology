'use client';

import { useState } from 'react';

import * as api from '@/lib/api-client';

const SAMPLE_QUERIES = [
  '지난 4주간 20대 여성에게 검색 빈도가 급증한 성분 Top10',
  '글루텐프리 카테고리 신상품 트렌드',
  '임산부 친화 제품 카테고리별 점유율',
  '시카 케어 라인 경쟁 브랜드 분석',
];

export default function InsightsPage() {
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState(28);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.InsightsResponse | null>(null);

  async function run(query: string, days = period) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.insights(query, days);
      setResult(res);
      setQ(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  const maxValue = result ? Math.max(...result.chart_spec.data.map((d) => d.value), 1) : 1;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold mb-1">시나리오 C · MD 인사이트</h1>
      <p className="text-sm text-slate-500 mb-6">
        자연어 BI 쿼리 → AgentCore Code Interpreter (Phase 4 wiring) → 차트 + Cytoscape 드릴다운.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(q.trim()); }}
        className="flex gap-2 mb-3"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="자연어 BI 쿼리"
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2"
        />
        <select
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        >
          <option value={7}>지난 7일</option>
          <option value={28}>지난 28일</option>
          <option value={90}>지난 90일</option>
        </select>
        <button
          type="submit"
          disabled={loading || !q.trim()}
          className="px-5 py-2 rounded-lg bg-orange-500 text-white disabled:bg-slate-300 hover:bg-orange-600 transition"
        >
          {loading ? '분석 중…' : '분석'}
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mb-6">
        {SAMPLE_QUERIES.map((qq) => (
          <button
            key={qq}
            onClick={() => { setQ(qq); run(qq); }}
            className="text-xs px-3 py-1 rounded-full border border-slate-300 dark:border-slate-700 hover:border-orange-500 hover:text-orange-600 transition"
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
        <article className="space-y-6">
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            {result.answer_ko}
          </p>

          <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold mb-4">{result.chart_spec.title}</h2>
            <ul className="space-y-2">
              {result.chart_spec.data.map((d, i) => (
                <li key={i} className="flex items-center gap-3">
                  <div className="w-32 text-xs truncate">{d.label}</div>
                  <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded">
                    <div
                      className="h-5 bg-gradient-to-r from-orange-400 to-rose-500 rounded transition-all"
                      style={{ width: `${(d.value / maxValue) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-xs text-right tabular-nums">{d.value}</div>
                </li>
              ))}
            </ul>
          </section>
        </article>
      )}
    </div>
  );
}
