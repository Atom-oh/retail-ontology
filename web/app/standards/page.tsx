'use client';

import { useEffect, useState } from 'react';
import { BookOpen, FileText, Search as SearchIcon } from 'lucide-react';

import * as api from '@/lib/api-client';

export default function StandardsPage() {
  const [files, setFiles] = useState<{ file: string; rows: number }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState<api.StandardsTableResponse | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.ontologyStandards()
      .then((r) => {
        setFiles(r.items);
        if (r.items.length && !selected) setSelected(r.items[0].file);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    setTable(null);
    api.ontologyStandardsTable(selected, 500).then(setTable).catch((e) => setError(String(e)));
  }, [selected]);

  const rowsFiltered = (table?.rows ?? []).filter((r) => {
    if (!filter.trim()) return true;
    const f = filter.toLowerCase();
    return Object.values(r).some((v) => (v ?? '').toLowerCase().includes(f));
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">메타 · 표준 매핑</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-300 border border-accent-500/30">
          GS1 GPC ↔ 식약처 · INCI ↔ 한글 · FoodOn
        </span>
      </header>

      <div className="flex-1 grid xl:grid-cols-[280px_1fr] min-h-0">
        <aside className="border-r border-ink-700 bg-ink-900 flex flex-col min-h-0">
          <div className="p-4 border-b border-ink-700">
            <h1 className="text-base font-bold text-ink-100 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-accent-400" /> Standards
            </h1>
            <p className="text-[10px] text-ink-400 mt-1 leading-relaxed">
              레거시 표준에서 한국 시장 어댑터로의 매핑 — 데이터 적재 시 매번 참조됨.
            </p>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {files.length === 0 && !error && <li className="text-xs text-ink-500 italic p-4">로딩 중…</li>}
            {files.map((f) => {
              const active = f.file === selected;
              return (
                <li key={f.file}>
                  <button onClick={() => setSelected(f.file)}
                    className={[
                      'w-full text-left px-4 py-2.5 border-b border-ink-700/40 transition',
                      active ? 'bg-accent-500/10 border-l-2 border-l-accent-500' : 'hover:bg-ink-800',
                    ].join(' ')}>
                    <div className="flex items-center gap-2">
                      <FileText className={`w-3.5 h-3.5 ${active ? 'text-accent-300' : 'text-ink-400'}`} />
                      <span className={`text-xs font-medium truncate ${active ? 'text-accent-200' : 'text-ink-100'}`}>{f.file}</span>
                    </div>
                    <div className="text-[10px] text-ink-400 mt-0.5 ml-5">{f.rows.toLocaleString()} rows</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="flex flex-col min-h-0 overflow-y-auto">
          {error && <div className="m-6 p-3 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-sm">{error}</div>}
          {table && (
            <div className="px-6 py-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-base font-semibold text-ink-100 font-mono">{table.file}</h2>
                  <p className="text-[10px] text-ink-400 mt-0.5">{table.total.toLocaleString()} rows · {table.columns.length} columns</p>
                </div>
                <div className="relative">
                  <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-500" />
                  <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="필터…"
                    className="rounded bg-ink-800 border border-ink-700 text-xs pl-7 pr-3 py-1.5 text-ink-100 outline-none focus:border-accent-500 placeholder:text-ink-500" />
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-800">
                <table className="w-full text-xs">
                  <thead className="bg-ink-900 sticky top-0 z-10">
                    <tr>
                      {table.columns.map((c) => (
                        <th key={c} className="text-left px-3 py-2 border-b border-ink-700 text-accent-300 font-mono font-semibold">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsFiltered.map((row, i) => (
                      <tr key={i} className="border-b border-ink-700/40 hover:bg-ink-700/30">
                        {table.columns.map((c) => (
                          <td key={c} className="px-3 py-1.5 text-ink-200 truncate max-w-xs">{row[c] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rowsFiltered.length === 0 && (
                  <div className="text-center text-xs text-ink-500 italic p-6">매칭된 row 없음</div>
                )}
              </div>
            </div>
          )}
          {!table && !error && (
            <div className="flex-1 flex items-center justify-center text-sm text-ink-500 italic">CSV 로딩 중…</div>
          )}
        </section>
      </div>
    </div>
  );
}
