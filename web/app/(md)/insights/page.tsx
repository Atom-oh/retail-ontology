'use client';

import { useState } from 'react';

import * as api from '@/lib/api-client';
import { MarkdownView } from '@/components/MarkdownView';

const SAMPLE_QUERIES = [
  '지난 4주간 20대 여성에게 검색 빈도가 급증한 성분 Top10',
  '글루텐프리 카테고리 신상품 트렌드',
  '임산부 친화 제품 카테고리별 점유율',
  '시카 케어 라인 경쟁 브랜드 분석',
];

// Human-readable label + tone for each phase emitted by /api/insights/stream.
const PHASE_META: Record<string, { label: string; tone: string }> = {
  neptune: { label: 'Neptune Trend ↔ Ingredient 집계', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  bedrock: { label: 'Sonnet 4.6 분석',                   tone: 'border-orange-500/40 bg-orange-500/10 text-orange-200' },
  error:   { label: '오류',                              tone: 'border-rose-500/40 bg-rose-500/10 text-rose-200' },
};

export default function InsightsPage() {
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState(28);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.InsightsResponse | null>(null);
  const [phases, setPhases] = useState<api.InsightsPhase[]>([]);
  const [streamingText, setStreamingText] = useState('');

  async function run(query: string, days = period) {
    setLoading(true);
    setError(null);
    setResult(null);
    setPhases([]);
    setStreamingText('');
    setQ(query);
    try {
      await api.insightsStream(
        { q: query, periodDays: days },
        (event) => {
          if (event.type === 'phase') {
            setPhases((p) => [...p, event.data]);
          } else if (event.type === 'delta') {
            setStreamingText((t) => t + event.data.text);
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

      {/* Streaming phase strip + live token preview */}
      {(loading || phases.length > 0) && !result && (
        <div className="mb-6 rounded-lg border border-slate-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-3 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-ink-400 font-semibold flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse-soft" />
            인사이트 파이프라인 진행 중 — {phases.length}단계 완료
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
                </li>
              );
            })}
            {loading && (
              <li className="text-[11px] font-mono px-2 py-1 rounded border border-slate-300/30 bg-slate-300/5 text-slate-400 animate-pulse-soft">
                다음 단계…
              </li>
            )}
          </ol>
          {streamingText && (
            <div className="border-t border-slate-200 dark:border-ink-700 pt-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-ink-400 font-semibold mb-1.5">
                Sonnet 4.6 토큰 스트리밍
              </div>
              <MarkdownView text={streamingText} className="text-slate-700 dark:text-slate-300" />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-sm">
          오류: {error}
        </div>
      )}

      {result && (
        <article className="space-y-6">
          <MarkdownView
            text={result.answer_ko}
            className="text-slate-700 dark:text-slate-300"
          />

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
