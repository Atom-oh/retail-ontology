'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

import * as api from '@/lib/api-client';

const SEV_STYLE: Record<api.ValidationCheck['severity'], { tone: string; icon: typeof CheckCircle2; label: string }> = {
  ok:    { tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2,  label: 'OK' },
  warn:  { tone: 'border-amber-500/40 bg-amber-500/10 text-amber-300',       icon: AlertTriangle, label: 'WARN' },
  error: { tone: 'border-red-500/40 bg-red-500/10 text-red-300',             icon: AlertCircle,   label: 'ERROR' },
};

export default function ValidationPage() {
  const [data, setData] = useState<api.ValidationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.ontologyValidation());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">메타 · 검증 리포트</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-300 border border-accent-500/30">
          INCI · FoodOn · GS1/KFDA · Loader Coverage
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto text-xs px-3 py-1.5 rounded border border-ink-700 bg-ink-800 hover:border-accent-500 text-ink-200 disabled:opacity-50"
        >
          {loading ? '재계산 중…' : '다시 검사'}
        </button>
      </header>

      <div className="flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-50 mb-1 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-accent-400" /> 매핑 검증 리포트
          </h1>
          <p className="text-sm text-ink-400">
            적재된 Neptune 그래프와 표준 매핑 파일 간의 정합성 검사 — 미매핑 ID, 누락된 GS1 brick, Channel 미할당 SKU를 검출합니다.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-sm">
            오류: {error}
          </div>
        )}

        {loading && !data && (
          <div className="text-sm text-ink-400 italic">검증 중…</div>
        )}

        {data && (
          <ul className="space-y-3">
            {data.checks.map((c) => {
              const style = SEV_STYLE[c.severity];
              const Icon = style.icon;
              const ratio = c.expected > 0 ? Math.round((c.covered / c.expected) * 100) : 100;
              return (
                <li
                  key={c.name}
                  className={`p-4 rounded-lg border ${style.tone}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h2 className="text-sm font-semibold text-ink-100">{c.name}</h2>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink-900/60 border border-ink-700 text-ink-300">
                          {c.standard}
                        </span>
                        <span className="text-[10px] font-mono uppercase tracking-wider">{style.label}</span>
                      </div>
                      <p className="text-xs mt-1 text-ink-300/90">{c.note}</p>
                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex-1 h-2 bg-ink-900 rounded overflow-hidden">
                          <div
                            className={[
                              'h-2 rounded transition-all',
                              c.severity === 'ok' ? 'bg-emerald-500' :
                              c.severity === 'warn' ? 'bg-amber-400' : 'bg-red-500',
                            ].join(' ')}
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                        <div className="text-xs font-mono tabular-nums text-ink-200 shrink-0">
                          {c.covered.toLocaleString()} / {c.expected.toLocaleString()} ({ratio}%)
                        </div>
                      </div>
                      {c.missing.length > 0 && (
                        <details className="mt-3">
                          <summary className="text-xs cursor-pointer text-ink-300 hover:text-ink-100">
                            미매핑 샘플 ({c.missing.length}개) 보기
                          </summary>
                          <ul className="mt-2 grid grid-cols-2 gap-1 max-h-48 overflow-y-auto pr-2">
                            {c.missing.map((m) => (
                              <li
                                key={m}
                                className="font-mono text-[11px] text-ink-300 bg-ink-900/60 border border-ink-700 rounded px-2 py-1 truncate"
                              >
                                {m}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
