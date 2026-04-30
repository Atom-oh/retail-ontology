'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { TrendingDown, AlertTriangle, Megaphone, Crown, UserCircle, Sparkles } from 'lucide-react';

import * as api from '@/lib/api-client';

const CytoscapeView = dynamic(
  () => import('@/components/graph/CytoscapeView').then((m) => m.CytoscapeView),
  { ssr: false },
);

// Tier badge palette — keeps the dashboard cards visually consistent with
// the membership color identity used across Sidebar / Object Explorer.
const TIER_PALETTE: Record<string, { bg: string; text: string; border: string }> = {
  VIP:    { bg: 'bg-yellow-500/15', text: 'text-yellow-300', border: 'border-yellow-500/40' },
  Gold:   { bg: 'bg-amber-500/15',  text: 'text-amber-300',  border: 'border-amber-500/40' },
  Silver: { bg: 'bg-slate-400/15',  text: 'text-slate-200',  border: 'border-slate-400/40' },
  Bronze: { bg: 'bg-orange-700/20', text: 'text-orange-200', border: 'border-orange-600/40' },
};

function fmtKrw(v: number): string {
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}천만`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(0)}만`;
  return v.toLocaleString();
}

function riskTone(risk: number): string {
  if (risk >= 0.7) return 'text-rose-300';
  if (risk >= 0.4) return 'text-amber-300';
  return 'text-emerald-300';
}

export default function ChurnPage() {
  const [data, setData] = useState<api.ChurnDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<api.ChurnMemberDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.churnDashboard(30)
      .then((d) => { if (!cancelled) { setData(d); if (d.top_at_risk[0]) setSelectedId(d.top_at_risk[0].member_id); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'dashboard failed'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true); setDetail(null);
    api.churnMember(selectedId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { /* keep dashboard subgraph as fallback */ })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">시나리오 I · 이탈 위험 진단</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/30">
          Member × Touchpoint × RFM → winback 추천
        </span>
      </header>

      <div className="flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-50 mb-1 flex items-center gap-2">
            <TrendingDown className="w-6 h-6 text-orange-400" /> 이탈 위험 진단
          </h1>
          <p className="text-sm text-ink-400">
            VIP/고가치 회원 중 90일 미접속 + 캠페인 미응답자를 식별하고, 페르소나별 분포와 winback 캠페인을 추천합니다.
            합성 1,000명 회원 데이터에 RFM(Recency·Frequency·Monetary) 기반 churn_risk가 적재되어 있습니다.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* KPI strip */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={UserCircle} label="총 회원" value={data?.summary.total_members ?? '—'} accent="text-orange-300" />
          <KpiCard
            icon={AlertTriangle}
            label="고위험 (≥0.7)"
            value={data ? `${data.summary.high_risk_count} (${(data.summary.high_risk_pct * 100).toFixed(1)}%)` : '—'}
            accent="text-rose-300"
          />
          <KpiCard icon={Crown} label="VIP 이탈 위험" value={data?.summary.vip_at_risk_count ?? '—'} accent="text-yellow-300" />
          <KpiCard icon={TrendingDown} label="평균 미접속(일)" value={data?.summary.avg_recency_days ?? '—'} accent="text-amber-300" />
        </section>

        {/* Workspace */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left column: breakdowns + winback */}
          <div className="flex flex-col gap-4">
            <Card title="회원 등급별 위험 분포">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-400">
                  <tr>
                    <th className="text-left py-1.5">등급</th>
                    <th className="text-right py-1.5">총원</th>
                    <th className="text-right py-1.5">고위험</th>
                    <th className="text-right py-1.5">평균 risk</th>
                    <th className="text-right py-1.5">평균 LTV</th>
                  </tr>
                </thead>
                <tbody className="text-ink-200">
                  {data?.tier_breakdown.map((t) => (
                    <tr key={t.tier} className="border-t border-ink-700/60">
                      <td className="py-1.5">
                        <TierBadge tier={t.tier} />
                      </td>
                      <td className="text-right">{t.total}</td>
                      <td className={`text-right font-medium ${t.at_risk > 0 ? 'text-rose-300' : 'text-ink-300'}`}>{t.at_risk}</td>
                      <td className={`text-right ${riskTone(t.avg_churn_risk)}`}>{t.avg_churn_risk.toFixed(2)}</td>
                      <td className="text-right text-ink-300">{fmtKrw(t.avg_ltv_krw)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="페르소나별 위험 분포">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-400">
                  <tr>
                    <th className="text-left py-1.5">페르소나</th>
                    <th className="text-right py-1.5">총원</th>
                    <th className="text-right py-1.5">고위험</th>
                    <th className="text-right py-1.5">평균 risk</th>
                  </tr>
                </thead>
                <tbody className="text-ink-200">
                  {data?.persona_breakdown.map((p) => (
                    <tr key={p.persona_id} className="border-t border-ink-700/60">
                      <td className="py-1.5">{p.persona_label_ko || p.persona_id}</td>
                      <td className="text-right">{p.total}</td>
                      <td className={`text-right font-medium ${p.at_risk > 0 ? 'text-rose-300' : 'text-ink-300'}`}>{p.at_risk}</td>
                      <td className={`text-right ${riskTone(p.avg_churn_risk)}`}>{p.avg_churn_risk.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="추천 Winback 캠페인" icon={Megaphone}>
              {data?.recommended_winback.length ? (
                <ul className="flex flex-col gap-2">
                  {data.recommended_winback.map((c) => (
                    <li key={c.campaign_id} className="rounded-md border border-ink-700 bg-ink-900 p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink-100">{c.name_ko}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">
                          {c.channel}
                        </span>
                      </div>
                      <div className="text-xs text-ink-400 mt-1">
                        예상 응답률 {(c.expected_response_rate * 100).toFixed(0)}%
                        {c.target_persona_ids.length > 0 && (
                          <span className="ml-2">· 대상 페르소나 {c.target_persona_ids.join(', ')}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <div className="text-sm text-ink-400">winback 캠페인 없음</div>}
            </Card>
          </div>

          {/* Right column: top at-risk list + selected member detail */}
          <div className="flex flex-col gap-4">
            <Card title={`이탈 위험 상위 ${data?.top_at_risk.length ?? 0}명`}>
              <div className="max-h-72 overflow-y-auto -mx-1">
                <table className="w-full text-sm">
                  <thead className="text-xs text-ink-400 sticky top-0 bg-ink-800">
                    <tr>
                      <th className="text-left px-2 py-1.5">회원</th>
                      <th className="text-left px-2 py-1.5">등급</th>
                      <th className="text-right px-2 py-1.5">risk</th>
                      <th className="text-right px-2 py-1.5">미접속</th>
                      <th className="text-right px-2 py-1.5">LTV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.top_at_risk.map((m) => {
                      const active = selectedId === m.member_id;
                      return (
                        <tr
                          key={m.member_id}
                          onClick={() => setSelectedId(m.member_id)}
                          className={`cursor-pointer border-t border-ink-700/60 ${active ? 'bg-orange-500/10' : 'hover:bg-ink-700/40'}`}
                        >
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-ink-100">{m.name_ko}</div>
                            <div className="text-[10px] text-ink-500 font-mono">{m.member_id}</div>
                          </td>
                          <td className="px-2 py-1.5"><TierBadge tier={m.tier} /></td>
                          <td className={`text-right px-2 py-1.5 font-mono ${riskTone(m.churn_risk)}`}>{m.churn_risk.toFixed(2)}</td>
                          <td className="text-right px-2 py-1.5 text-ink-300">{m.recency_days}일</td>
                          <td className="text-right px-2 py-1.5 text-ink-300">{fmtKrw(m.ltv_krw)}원</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title={detail ? `${detail.member.name_ko} (${detail.member.member_id}) — 1-hop 그래프` : '회원 1-hop 그래프'}>
              <CytoscapeView
                subgraph={detail?.subgraph ?? data?.subgraph ?? { nodes: [], edges: [] }}
                wowNodeIds={selectedId ? [`mem_${selectedId.replace('mem_', '')}`] : []}
                height={320}
              />
              {detail && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-ink-700 bg-ink-900 p-2">
                    <div className="text-ink-400">최근 거래 ({detail.transactions.length}건)</div>
                    {detail.transactions.slice(0, 3).map((t) => (
                      <div key={t.transaction_id} className="text-ink-200 mt-0.5 truncate">
                        {t.ts} · {fmtKrw(t.amount_krw)}원 · {t.product_name_ko ?? t.sku_id ?? '—'}
                      </div>
                    ))}
                    {detail.transactions.length === 0 && <div className="text-ink-500 mt-0.5">거래 없음</div>}
                  </div>
                  <div className="rounded-md border border-ink-700 bg-ink-900 p-2">
                    <div className="text-ink-400">캠페인 응답률 {(detail.response_rate * 100).toFixed(0)}%</div>
                    {detail.recommended_campaign && (
                      <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                        <Sparkles className="w-3 h-3 text-fuchsia-300" />
                        <span className="text-ink-200">추천:</span>
                        <span className="text-fuchsia-200">{detail.recommended_campaign.name_ko}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {detailLoading && <div className="mt-2 text-xs text-ink-400">상세 로딩 중…</div>}
            </Card>
          </div>
        </section>
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
        {Icon && <Icon className="w-4 h-4 text-orange-300" />}
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const c = TIER_PALETTE[tier] ?? TIER_PALETTE.Bronze;
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded border ${c.bg} ${c.text} ${c.border}`}>
      {tier}
    </span>
  );
}
