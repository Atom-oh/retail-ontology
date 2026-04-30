'use client';

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Megaphone, Wallet, Users, Sparkles } from 'lucide-react';

import * as api from '@/lib/api-client';

const CHANNELS = ['kakao', 'push', 'email', 'sms', 'visit'] as const;

const CHANNEL_LABEL: Record<string, string> = {
  kakao: '카카오톡 푸시',
  push: '앱 푸시',
  email: '이메일',
  sms: 'SMS',
  visit: '매장 방문',
};

function fmtKrw(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}천만`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(0)}만`;
  return v.toLocaleString();
}

function roiTone(roi: number): string {
  if (roi >= 3) return 'text-emerald-300';
  if (roi >= 1) return 'text-amber-300';
  return 'text-rose-300';
}

// Heatmap intensity: response rate 0–35% mapped to alpha 0.05–0.6.
function heatBg(rate: number): string {
  const a = Math.min(0.6, 0.05 + rate * 1.6);
  return `rgba(217, 70, 239, ${a.toFixed(2)})`;  // fuchsia
}

export default function AcquisitionPage() {
  const [data, setData] = useState<api.AcquisitionDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.acquisitionDashboard()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'load failed'); });
    return () => { cancelled = true; };
  }, []);

  // Group matrix into [persona_id → {channel: cell}] for the heatmap render.
  const personaRows = useMemo(() => {
    if (!data) return [];
    const byPersona = new Map<string, { label: string; cells: Record<string, api.PersonaChannelCell> }>();
    for (const c of data.persona_channel_matrix) {
      if (!byPersona.has(c.persona_id)) byPersona.set(c.persona_id, { label: c.persona_label_ko, cells: {} });
      byPersona.get(c.persona_id)!.cells[c.channel] = c;
    }
    return Array.from(byPersona.entries()).map(([pid, v]) => ({ persona_id: pid, label: v.label, cells: v.cells }));
  }, [data]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">시나리오 J · 확보 채널 ROI</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/30">
          Campaign × Channel × Persona → ROI 매트릭스
        </span>
      </header>

      <div className="flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-50 mb-1 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-fuchsia-400" /> 확보 채널 ROI
          </h1>
          <p className="text-sm text-ink-400">
            Acquisition 캠페인별 비용 대비 확보 회원 수·LTV로 ROI를 산출하고, 페르소나×채널 응답률 매트릭스로
            "임산부 페르소나는 카카오톡 푸시가 이메일 대비 N배" 같은 인사이트를 직관화합니다.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* KPI strip */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Megaphone} label="확보 캠페인" value={data?.summary.total_campaigns ?? '—'} accent="text-fuchsia-300" />
          <KpiCard
            icon={Wallet}
            label="총 집행 비용"
            value={data ? `${fmtKrw(data.summary.total_cost_krw)}원` : '—'}
            accent="text-amber-300"
          />
          <KpiCard
            icon={Users}
            label="확보 회원 (응답)"
            value={data?.summary.total_attributed_members ?? '—'}
            accent="text-emerald-300"
          />
          <KpiCard
            icon={Sparkles}
            label="블렌디드 ROI"
            value={data ? `${data.summary.blended_roi.toFixed(2)}×` : '—'}
            accent={data ? roiTone(data.summary.blended_roi) : 'text-ink-300'}
          />
        </section>

        {data?.summary.best_channel && (
          <div className="text-xs text-ink-300 -mt-2">
            최고 효율 채널: <span className="text-fuchsia-300 font-semibold">{CHANNEL_LABEL[data.summary.best_channel] ?? data.summary.best_channel}</span>
            <span className="ml-1">· ROI {data.summary.best_channel_roi.toFixed(2)}×</span>
          </div>
        )}

        {/* Persona × Channel heatmap — the wow visual */}
        <Card title="페르소나 × 채널 응답률 히트맵">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-400">
                <tr>
                  <th className="text-left px-2 py-1.5">페르소나</th>
                  {CHANNELS.map((c) => (
                    <th key={c} className="text-right px-2 py-1.5">{CHANNEL_LABEL[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {personaRows.map((row) => (
                  <tr key={row.persona_id} className="border-t border-ink-700/60">
                    <td className="px-2 py-1.5 text-ink-100">{row.label || row.persona_id}</td>
                    {CHANNELS.map((c) => {
                      const cell = row.cells[c];
                      if (!cell || cell.sent === 0) {
                        return <td key={c} className="px-2 py-1.5 text-right text-ink-600">—</td>;
                      }
                      return (
                        <td
                          key={c}
                          className="px-2 py-1.5 text-right font-mono text-ink-100"
                          style={{ backgroundColor: heatBg(cell.response_rate) }}
                          title={`${cell.responded}/${cell.sent} (${(cell.response_rate * 100).toFixed(1)}%)`}
                        >
                          {(cell.response_rate * 100).toFixed(1)}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] text-ink-500">
            셀 색상은 응답률 비례 (fuchsia). 셀에 마우스 올리면 발송/응답 절대치 확인.
          </div>
        </Card>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Channel rollup */}
          <Card title="채널별 ROI">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-400">
                <tr>
                  <th className="text-left py-1.5">채널</th>
                  <th className="text-right py-1.5">발송</th>
                  <th className="text-right py-1.5">응답률</th>
                  <th className="text-right py-1.5">확보 LTV</th>
                  <th className="text-right py-1.5">ROI</th>
                </tr>
              </thead>
              <tbody>
                {data?.channels.map((c) => (
                  <tr key={c.channel} className="border-t border-ink-700/60">
                    <td className="py-1.5 text-ink-100">{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                    <td className="text-right text-ink-200">{c.sent.toLocaleString()}</td>
                    <td className="text-right text-ink-200">{(c.response_rate * 100).toFixed(1)}%</td>
                    <td className="text-right text-ink-200">{fmtKrw(c.attributed_ltv_krw)}원</td>
                    <td className={`text-right font-mono ${roiTone(c.roi)}`}>{c.roi.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Per-campaign list */}
          <Card title="캠페인별 ROI (acquisition)">
            <div className="max-h-80 overflow-y-auto -mx-1">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-400 sticky top-0 bg-ink-800">
                  <tr>
                    <th className="text-left px-2 py-1.5">캠페인</th>
                    <th className="text-right px-2 py-1.5">비용</th>
                    <th className="text-right px-2 py-1.5">확보</th>
                    <th className="text-right px-2 py-1.5">LTV</th>
                    <th className="text-right px-2 py-1.5">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.campaigns.map((c) => (
                    <tr key={c.campaign_id} className="border-t border-ink-700/60">
                      <td className="px-2 py-1.5">
                        <div className="text-ink-100">{c.name_ko}</div>
                        <div className="text-[10px] text-ink-500 font-mono">
                          {CHANNEL_LABEL[c.channel] ?? c.channel}
                          {c.target_persona_ids.length > 0 && (
                            <span className="ml-1.5 px-1 rounded bg-ink-700/60">
                              {c.target_persona_ids.length === 1 ? c.target_persona_ids[0] : `+${c.target_persona_ids.length}`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-right px-2 py-1.5 text-ink-200">{fmtKrw(c.cost_krw)}원</td>
                      <td className="text-right px-2 py-1.5 text-ink-200">{c.attributed_members}</td>
                      <td className="text-right px-2 py-1.5 text-ink-200">{fmtKrw(c.attributed_ltv_krw)}원</td>
                      <td className={`text-right px-2 py-1.5 font-mono ${roiTone(c.roi)}`}>{c.roi.toFixed(2)}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800 p-4">
      <h2 className="text-sm font-semibold text-ink-100 mb-3">{title}</h2>
      {children}
    </div>
  );
}
