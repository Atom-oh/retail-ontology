'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Crown, Layers, Users, Sparkles } from 'lucide-react';

import * as api from '@/lib/api-client';

function fmtKrw(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}천만`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(0)}만`;
  return v.toLocaleString();
}

function liftTone(lift: number): string {
  if (lift >= 2) return 'text-emerald-300';
  if (lift >= 1.3) return 'text-amber-300';
  return 'text-ink-300';
}

// Bar width proportional to lift, capped so super-outliers don't crowd out.
function liftBarWidth(lift: number, maxLift: number): string {
  if (maxLift <= 0) return '0%';
  return `${Math.min(100, (lift / maxLift) * 100).toFixed(1)}%`;
}

export default function TierUpPage() {
  const [data, setData] = useState<api.TierUpDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.tierUpDashboard(25)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'load failed'); });
    return () => { cancelled = true; };
  }, []);

  const maxProductLift = data?.product_lift[0]?.lift ?? 1;
  const maxCategoryLift = data?.category_lift[0]?.lift ?? 1;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">시나리오 K · 등급 상승 경로</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-300 border border-yellow-500/30">
          Silver vs Gold lift → 등급 상승 시그널 + 업그레이드 후보
        </span>
      </header>

      <div className="flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-50 mb-1 flex items-center gap-2">
            <ArrowUpRight className="w-6 h-6 text-yellow-400" /> 등급 상승 경로
          </h1>
          <p className="text-sm text-ink-400">
            Gold 회원이 Silver 회원 대비 더 많이 구매하는 카테고리·상품을 lift로 비교하여 "등급 상승 시그널"을 식별합니다.
            동시에 LTV 1.5M~2M 사이 Silver 회원을 "업그레이드 후보"로 추출합니다.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Users} label="Silver 회원" value={data?.summary.silver_count ?? '—'} accent="text-slate-200" />
          <KpiCard icon={Crown} label="Gold 회원" value={data?.summary.gold_count ?? '—'} accent="text-amber-300" />
          <KpiCard
            icon={ArrowUpRight}
            label="업그레이드 후보"
            value={data?.summary.candidates_count ?? '—'}
            accent="text-yellow-300"
          />
          <KpiCard
            icon={Sparkles}
            label="후보 평균 LTV"
            value={data ? `${fmtKrw(data.summary.avg_candidate_ltv_krw)}원` : '—'}
            accent="text-emerald-300"
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Category lift */}
          <Card title="카테고리별 Silver→Gold lift" icon={Layers}>
            <ul className="flex flex-col gap-1.5">
              {data?.category_lift.map((c) => (
                <li key={c.gs1_brick_code} className="flex items-center gap-2 text-sm">
                  <div className="w-32 truncate text-ink-100" title={c.name_ko}>{c.name_ko || c.gs1_brick_code}</div>
                  <div className="flex-1 h-2 rounded bg-ink-700/50 overflow-hidden">
                    <div
                      className="h-full bg-yellow-400/70"
                      style={{ width: liftBarWidth(c.lift, maxCategoryLift) }}
                    />
                  </div>
                  <div className={`w-12 text-right font-mono text-xs ${liftTone(c.lift)}`}>{c.lift.toFixed(2)}×</div>
                  <div className="w-20 text-right text-[10px] text-ink-500 font-mono">
                    G{c.gold_buyers}/S{c.silver_buyers}
                  </div>
                </li>
              ))}
              {!data?.category_lift.length && <li className="text-sm text-ink-400">데이터 없음</li>}
            </ul>
          </Card>

          {/* Product lift */}
          <Card title="상품별 Silver→Gold lift (top 25)">
            <div className="max-h-96 overflow-y-auto -mx-1">
              <ul className="flex flex-col gap-1.5 px-1">
                {data?.product_lift.map((p) => (
                  <li key={p.sku_id} className="flex items-center gap-2 text-sm">
                    <div className="w-44 truncate text-ink-100" title={p.name_ko}>{p.name_ko || p.sku_id}</div>
                    <div className="flex-1 h-2 rounded bg-ink-700/50 overflow-hidden">
                      <div
                        className="h-full bg-yellow-400/70"
                        style={{ width: liftBarWidth(p.lift, maxProductLift) }}
                      />
                    </div>
                    <div className={`w-12 text-right font-mono text-xs ${liftTone(p.lift)}`}>{p.lift.toFixed(2)}×</div>
                    {p.domain && (
                      <span className="w-12 text-right text-[10px] text-ink-500 font-mono">{p.domain === 'beauty' ? '뷰티' : '식품'}</span>
                    )}
                  </li>
                ))}
                {!data?.product_lift.length && <li className="text-sm text-ink-400">데이터 없음</li>}
              </ul>
            </div>
          </Card>
        </section>

        {/* Upgrade candidates */}
        <Card title={`업그레이드 후보 (Silver, LTV ≥ 1.5M)`}>
          <div className="max-h-80 overflow-y-auto -mx-1">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-400 sticky top-0 bg-ink-800">
                <tr>
                  <th className="text-left px-2 py-1.5">회원</th>
                  <th className="text-left px-2 py-1.5">페르소나</th>
                  <th className="text-right px-2 py-1.5">LTV</th>
                  <th className="text-right px-2 py-1.5">Gold까지</th>
                  <th className="text-right px-2 py-1.5">Frequency</th>
                  <th className="text-right px-2 py-1.5">미접속</th>
                  <th className="text-right px-2 py-1.5">churn risk</th>
                </tr>
              </thead>
              <tbody>
                {data?.upgrade_candidates.map((m) => {
                  const riskTone =
                    m.churn_risk >= 0.7 ? 'text-rose-300'
                    : m.churn_risk >= 0.4 ? 'text-amber-300'
                    : 'text-emerald-300';
                  return (
                    <tr key={m.member_id} className="border-t border-ink-700/60 hover:bg-ink-700/30">
                      <td className="px-2 py-1.5">
                        <div className="text-ink-100">{m.name_ko}</div>
                        <div className="text-[10px] text-ink-500 font-mono">{m.member_id}</div>
                      </td>
                      <td className="px-2 py-1.5 text-ink-200">{m.persona_label_ko || m.persona_id || '—'}</td>
                      <td className="text-right px-2 py-1.5 text-ink-200">{fmtKrw(m.ltv_krw)}원</td>
                      <td className="text-right px-2 py-1.5 text-yellow-300">{fmtKrw(m.gap_to_gold_krw)}원</td>
                      <td className="text-right px-2 py-1.5 text-ink-200">{m.frequency}회</td>
                      <td className="text-right px-2 py-1.5 text-ink-300">{m.recency_days}일</td>
                      <td className={`text-right px-2 py-1.5 font-mono ${riskTone}`}>{m.churn_risk.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {!data?.upgrade_candidates.length && (
                  <tr><td colSpan={7} className="text-center py-3 text-ink-400">후보 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-400">
        <Icon className={`w-3.5 h-3.5 ${accent}`} /> {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

function Card({
  title, icon: Icon, children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon className="w-4 h-4 text-yellow-300" />}
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
      </div>
      {children}
    </div>
  );
}
