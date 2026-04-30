'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Package, FlaskConical, HeartPulse, TrendingUp, Tag, Layers, Users, Store,
  Building2, MessageCircle, MapPin, Boxes, Truck, CalendarClock, PackageOpen,
  Network as NetworkIcon, Search as SearchIcon, ChevronRight,
} from 'lucide-react';

import * as api from '@/lib/api-client';

const CytoscapeView = dynamic(
  () => import('@/components/graph/CytoscapeView').then((m) => m.CytoscapeView),
  { ssr: false },
);

// Per-slug visual identity — must match Sidebar.tsx and CytoscapeView's
// type-coded styling. Keeping these inline (rather than importing from
// Sidebar) avoids client-import cycles in the standalone build.
const TYPE_META: Record<
  string,
  { ko: string; desc: string; color: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }
> = {
  product:    { ko: '상품',     desc: 'GS1 GPC 4-tier brick + 한국 식약처 어댑터', color: '#60a5fa', icon: Package },
  ingredient: { ko: '성분',     desc: 'INCI + FoodOn aliasing',                    color: '#34d399', icon: FlaskConical },
  concern:    { ko: '관심사/효능', desc: 'schema.org HealthCondition + 식약처 효능',    color: '#fbbf24', icon: HeartPulse },
  trend:      { ko: '트렌드',   desc: 'kbeauty / diet / functional / seasonal',    color: '#a78bfa', icon: TrendingUp },
  brand:      { ko: '브랜드',   desc: 'Manufacturer 산하 브랜드',                  color: '#f472b6', icon: Tag },
  category:   { ko: '카테고리', desc: 'GS1 GPC brick code',                        color: '#94a3b8', icon: Layers },
  persona:    { ko: '페르소나', desc: '40 합성 페르소나 — 임산부/4세아이/캠퍼/...',   color: '#fb923c', icon: Users },
  channel:    { ko: '채널',     desc: '편의점 / 드럭스토어 / 뷰티스토어 / 온라인',    color: '#22d3ee', icon: Store },
  manufacturer: { ko: '제조사',   desc: '브랜드 산하 제조 법인 — 30개사',             color: '#e879f9', icon: Building2 },
  review:     { ko: '리뷰',     desc: '페르소나 작성 리뷰 — helpful_count 상위',     color: '#facc15', icon: MessageCircle },
  region:     { ko: '지역',     desc: '17 광역시도 + 주요 시군구 (KOSTAT 행정구역코드)', color: '#0ea5e9', icon: MapPin },
  warehouse:  { ko: '물류센터', desc: '제조사 DC / 채널 RDC / 3PL 허브 / Last-mile', color: '#14b8a6', icon: Boxes },
  carrier:    { ko: '운송사',   desc: 'CJ대한통운·한진·롯데·우체국·쿠팡·판토스·콜드체인', color: '#06b6d4', icon: Truck },
  shipment:   { ko: '출하',     desc: '최근 30일 출하 — route + carrier + SKU 묶음', color: '#f59e0b', icon: PackageOpen },
  event:      { ko: '이벤트',   desc: '명절·날씨·프로모·파업·정전 12건',             color: '#ec4899', icon: CalendarClock },
};

export default function ObjectTypePage({ params }: { params: { type: string } }) {
  const meta = TYPE_META[params.type] ?? { ko: params.type, desc: '', color: '#94a3b8', icon: NetworkIcon };
  const Icon = meta.icon;

  const [list, setList] = useState<api.ObjectListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<api.ObjectDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Load list on type change
  useEffect(() => {
    let cancelled = false;
    setList(null); setListError(null); setSelectedId(null); setDetail(null);
    api.listObjects(params.type, 30)
      .then((res) => { if (!cancelled) setList(res); })
      .catch((e) => { if (!cancelled) setListError(e instanceof Error ? e.message : 'list failed'); });
    return () => { cancelled = true; };
  }, [params.type]);

  // Load detail when selection changes
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true); setDetailError(null); setDetail(null);
    api.getObjectDetail(params.type, selectedId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setDetailError(e instanceof Error ? e.message : 'detail failed'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [params.type, selectedId]);

  // Auto-select first item once list arrives
  useEffect(() => {
    if (list && list.items.length && !selectedId) setSelectedId(list.items[0].id);
  }, [list, selectedId]);

  const filteredItems = useMemo(() => {
    if (!list) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return list.items;
    return list.items.filter(
      (it) => it.name.toLowerCase().includes(f) || it.id.toLowerCase().includes(f),
    );
  }, [list, filter]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400 flex items-center gap-2">
          <Link href="/" className="hover:text-accent-300">홈</Link>
          <ChevronRight className="w-3 h-3" />
          <span>객체 탐색</span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-ink-200">{meta.ko}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
            style={{ borderColor: `${meta.color}60`, color: meta.color, backgroundColor: `${meta.color}14` }}
          >
            {meta.ko === params.type ? params.type : `:${meta.ko}`}
          </span>
          {list && (
            <span className="text-[10px] font-mono text-ink-400">total {list.total}</span>
          )}
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[340px_1fr_360px] min-h-0">
        {/* ────── List pane ────── */}
        <aside className="border-r border-ink-700 bg-ink-900 flex flex-col min-h-0">
          <div className="p-4 border-b border-ink-700 flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${meta.color}22`, border: `1px solid ${meta.color}55` }}
            >
              <Icon className="w-4 h-4" style={{ color: meta.color }} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-100 truncate">{meta.ko}</div>
              <div className="text-[10px] text-ink-400 truncate">{meta.desc}</div>
            </div>
          </div>
          <div className="px-3 py-2 border-b border-ink-700 relative">
            <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`${meta.ko} 필터…`}
              className="w-full rounded bg-ink-800 border border-ink-700 text-xs pl-8 pr-3 py-1.5 text-ink-100 outline-none focus:border-accent-500 placeholder:text-ink-500"
            />
          </div>
          <ul className="flex-1 overflow-y-auto">
            {listError && (
              <li className="m-3 p-3 rounded text-xs bg-red-500/10 border border-red-500/30 text-red-300">
                {listError}
              </li>
            )}
            {!list && !listError && (
              <li className="text-xs text-ink-500 italic p-4">로딩 중…</li>
            )}
            {list && filteredItems.length === 0 && (
              <li className="text-xs text-ink-500 italic p-4">검색 결과 없음</li>
            )}
            {filteredItems.map((it) => {
              const active = it.id === selectedId;
              return (
                <li key={it.id}>
                  <button
                    onClick={() => setSelectedId(it.id)}
                    className={[
                      'w-full text-left px-4 py-2.5 border-b border-ink-700/40 transition',
                      active
                        ? 'bg-accent-500/10 border-l-2 border-l-accent-500'
                        : 'hover:bg-ink-800',
                    ].join(' ')}
                  >
                    <div className={`text-sm font-medium truncate ${active ? 'text-accent-200' : 'text-ink-100'}`}>
                      {it.name}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] font-mono text-ink-500 truncate">{it.id}</span>
                      {it.rank_score > 0 && (
                        <span className="text-[10px] font-mono text-ink-400">·{it.rank_score}</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ────── Graph canvas (1-hop neighborhood) ────── */}
        <section className="min-h-[500px] xl:min-h-0 p-4 flex flex-col">
          {detailLoading && (
            <div className="flex-1 flex items-center justify-center text-sm text-ink-400">
              그래프 로딩 중…
            </div>
          )}
          {detailError && !detailLoading && (
            <div className="m-3 p-3 rounded text-sm bg-red-500/10 border border-red-500/30 text-red-300">
              {detailError}
            </div>
          )}
          {!detailLoading && detail && (
            <CytoscapeView subgraph={detail.subgraph} wowNodeIds={[selectedId ?? '']} />
          )}
          {!detailLoading && !detail && !detailError && (
            <div className="flex-1 flex items-center justify-center text-sm text-ink-500">
              좌측에서 객체를 선택하면 1-hop 관계 그래프가 표시됩니다.
            </div>
          )}
        </section>

        {/* ────── Inspector pane ────── */}
        <aside className="border-l border-ink-700 bg-ink-900 flex flex-col min-h-0">
          {detail ? (
            <>
              <div className="p-4 border-b border-ink-700">
                <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-0.5">{detail.label}</div>
                <h2 className="text-base font-bold text-ink-50 leading-tight">{detail.name}</h2>
                <div className="text-[11px] font-mono text-ink-500 mt-1 truncate">id: {detail.id}</div>
                {Object.keys(detail.neighbor_summary).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(detail.neighbor_summary).map(([lbl, cnt]) => (
                      <span
                        key={lbl}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink-800 text-ink-300 border border-ink-700"
                      >
                        {lbl} ·{cnt}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-2">속성</div>
                <ul className="space-y-2">
                  {Object.entries(detail.properties).map(([k, v]) => (
                    <li key={k} className="text-xs">
                      <div className="text-ink-400 font-mono text-[10px]">{k}</div>
                      <div className="text-ink-100 break-words">
                        {typeof v === 'object' && v !== null
                          ? JSON.stringify(v)
                          : String(v ?? '—')}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-ink-500 italic px-4 text-center">
              선택된 객체의 속성과 인접 통계가 여기에 표시됩니다.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
