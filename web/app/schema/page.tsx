'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Network as NetworkIcon, BookOpen } from 'lucide-react';

import * as api from '@/lib/api-client';

const CytoscapeView = dynamic(
  () => import('@/components/graph/CytoscapeView').then((m) => m.CytoscapeView),
  { ssr: false },
);

export default function SchemaPage() {
  const [data, setData] = useState<api.SchemaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.ontologySchema().then(setData).catch((e) => setError(String(e)));
  }, []);

  // Build a Cytoscape-friendly meta-graph. Each class becomes a node sized
  // by data-density (linear with population, capped). Each relation becomes
  // an edge with the rel name as label.
  const subgraph = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    const counts = data.node_counts;
    const maxN = Math.max(1, ...Object.values(counts));
    const nodes = data.classes.map((c) => ({
      data: {
        id: c.label,
        label: c.label,           // matches CytoscapeView selectors when matching common labels
        name_ko: `${c.ko}\n(${counts[c.label] ?? 0})`,
        // Per-class background hint via CSS-color override (CytoscapeView's
        // built-in selectors will paint by `label` field; for non-listed
        // classes Cytoscape falls back to default — name_ko is what shows).
      },
    }));
    const edges = data.relations.map((r, i) => ({
      data: { id: `e${i}`, source: r.source, target: r.target, label: r.label },
    }));
    return { nodes, edges };
  }, [data]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">메타 · 온톨로지 스키마</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-300 border border-accent-500/30">
          12 classes · 15 relations
        </span>
      </header>

      <div className="flex-1 grid xl:grid-cols-[1fr_360px] min-h-0">
        <section className="p-4 min-h-[600px]">
          {error && <div className="m-3 p-3 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-sm">{error}</div>}
          {!data && !error && <p className="text-sm text-ink-400 p-4">로딩 중…</p>}
          {data && <CytoscapeView subgraph={subgraph} />}
        </section>

        <aside className="border-l border-ink-700 bg-ink-900 p-5 overflow-y-auto">
          <div className="mb-5">
            <h1 className="text-xl font-bold text-ink-50 flex items-center gap-2">
              <NetworkIcon className="w-5 h-5 text-accent-400" /> Ontology Schema
            </h1>
            <p className="text-xs text-ink-400 mt-1 leading-relaxed">
              12개 핵심 클래스와 15개 관계로 구성된 도메인 메타-그래프. 각 클래스 노드의 괄호 숫자는 현재 Neptune에 적재된 인스턴스 수.
            </p>
          </div>

          {data && (
            <>
              <section className="mb-5">
                <h2 className="text-xs uppercase tracking-wider text-ink-400 mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-accent-400" /> 적용 표준
                </h2>
                <ul className="space-y-1.5">
                  {data.standards.map((s) => (
                    <li key={s.label} className="px-3 py-2 rounded border border-ink-700 bg-ink-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink-100">{s.label}</span>
                        <span className={[
                          'text-[10px] font-mono px-1.5 py-0.5 rounded',
                          s.kind === 'korea' ? 'bg-rose-500/10 text-rose-300' : 'bg-cyan-500/10 text-cyan-300',
                        ].join(' ')}>
                          {s.kind}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-400 mt-0.5">{s.scope}</p>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h2 className="text-xs uppercase tracking-wider text-ink-400 mb-2">클래스 카운트</h2>
                <ul className="space-y-1">
                  {data.classes.map((c) => (
                    <li key={c.label} className="px-3 py-1.5 rounded border border-ink-700 bg-ink-800 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: c.color }} />
                        <span className="text-ink-200 truncate">{c.ko}</span>
                        <span className="font-mono text-[10px] text-ink-500 truncate">:{c.label}</span>
                      </div>
                      <span className="font-mono text-ink-100 shrink-0">{(data.node_counts[c.label] ?? 0).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
