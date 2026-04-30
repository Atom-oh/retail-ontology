'use client';

// Global persona-switch widget rendered in the top-right of the layout.
// Lists 40 personas (lazy-loaded once); clicking sets the active persona
// for all scenario pages via PersonaContext. Designed to stay collapsed
// (compact pill) until clicked so it doesn't dominate the header.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X, UserCheck } from 'lucide-react';

import * as api from '@/lib/api-client';
import { useActivePersona } from '@/lib/persona-context';

type PersonaItem = { persona_id: string; label: string };

export function PersonaSwitch() {
  const { active, setActive } = useActivePersona();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PersonaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const popRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load on first open. Backend `/api/personas` returns up to 50.
  useEffect(() => {
    if (!open || list) return;
    api.listPersonas(50)
      .then((res) => {
        const items = res.items.map((p) => ({
          persona_id: p.persona_id,
          label: p.label_ko || p.persona_id,
        }));
        setList(items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'load failed'));
  }, [open, list]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = list?.filter((p) =>
    !filter || p.label.includes(filter) || p.persona_id.includes(filter)
  ) ?? [];

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          'flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition',
          active
            ? 'border-orange-500/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/15'
            : 'border-ink-700 bg-ink-800 text-ink-300 hover:border-ink-600',
        ].join(' ')}
      >
        <UserCheck className="w-3.5 h-3.5" />
        {active ? (
          <>
            <span className="max-w-[180px] truncate">{active.label}</span>
            <span
              role="button"
              aria-label="페르소나 해제"
              className="ml-0.5 -mr-1 p-0.5 rounded hover:bg-orange-500/20"
              onClick={(e) => { e.stopPropagation(); setActive(null); }}
            >
              <X className="w-3 h-3" />
            </span>
          </>
        ) : (
          <span>페르소나 선택</span>
        )}
        <ChevronDown className={`w-3 h-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[320px] rounded-lg border border-ink-700 bg-ink-900 shadow-xl shadow-black/50 z-50 overflow-hidden">
          <div className="p-2 border-b border-ink-700">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="페르소나 검색 (예: 임산부)"
              className="w-full rounded border border-ink-700 bg-ink-800 text-ink-100 px-3 py-1.5 text-xs outline-none focus:border-orange-500 placeholder:text-ink-500"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {error && <div className="p-3 text-xs text-red-300">오류: {error}</div>}
            {!list && !error && (
              <div className="p-3 text-xs text-ink-500 italic">로딩 중…</div>
            )}
            {list && filtered.length === 0 && (
              <div className="p-3 text-xs text-ink-500 italic">일치하는 페르소나가 없습니다.</div>
            )}
            <ul>
              {filtered.map((p) => {
                const isActive = active?.id === p.persona_id;
                return (
                  <li key={p.persona_id}>
                    <button
                      onClick={() => {
                        setActive({ id: p.persona_id, label: p.label });
                        setOpen(false);
                      }}
                      className={[
                        'w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition',
                        isActive
                          ? 'bg-orange-500/15 text-orange-200'
                          : 'text-ink-300 hover:bg-ink-800',
                      ].join(' ')}
                    >
                      <span className="truncate">{p.label}</span>
                      <span className="font-mono text-[10px] text-ink-500 shrink-0">{p.persona_id}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
