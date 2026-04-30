'use client';

// LogisticsChatPanel — inline chat widget rendered inside the right aside
// of the /logistics page. Pipes natural-language queries to /api/chat with
// the new logistics tools (inventory_lookup, nearest_warehouses,
// shortest_path) so users can ask "서울 근처 냉장 거점", "시카 크림 재고 많은 곳",
// "마컬 송파 → 쿠팡 광주 최단 경로" without leaving the map view.
//
// Designed to fill its parent container — no floating, no fixed positioning.

import { useEffect, useRef, useState } from 'react';
import {
  Send, Wrench, Sparkles, RotateCcw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import * as api from '@/lib/api-client';
import { useActivePersona } from '@/lib/persona-context';

const SAMPLE_QUERIES = [
  '서울에서 가장 가까운 냉장 거점 5개',
  '시카 진정 크림 재고 가장 많은 거점은?',
  '마컬 송파 → 쿠팡 광주FC 최단 경로',
  '이마트 평택RDC 보유 SKU 상위 10개',
  '판토스 부산항터미널 입출고 lane',
];

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  toolLogs?: { tool: string; input: unknown }[];
};

export function LogisticsChatPanel() {
  const { active: activePersona } = useActivePersona();
  const [sessionId, setSessionId] = useState(() => `logis_${crypto.randomUUID()}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(query: string) {
    const text = query.trim();
    if (!text || streaming) return;
    const userMsg: ChatMessage = { role: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = '';
    const sessionToolLogs: { tool: string; input: unknown }[] = [];

    setMessages((m) => [...m, { role: 'assistant', text: '', toolLogs: [] }]);
    try {
      await api.chatStream(
        {
          session_id: sessionId, message: text,
          actor_id: activePersona?.id,
        },
        (event) => {
          if (event.type === 'log') {
            sessionToolLogs.push(event.data);
          } else if (event.type === 'delta') {
            assistantText += event.data.text;
            setMessages((m) => {
              const last = m[m.length - 1];
              return [
                ...m.slice(0, -1),
                { ...last, text: assistantText, toolLogs: [...sessionToolLogs] },
              ];
            });
          } else if (event.type === 'stop') {
            setMessages((m) => {
              const last = m[m.length - 1];
              return [
                ...m.slice(0, -1),
                { ...last, text: event.data.final, toolLogs: [...sessionToolLogs] },
              ];
            });
          }
        },
        controller.signal,
      );
    } catch (e) {
      const errText = e instanceof Error ? e.message : 'stream error';
      setMessages((m) => [...m, { role: 'assistant', text: `[오류] ${errText}` }]);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function reset() {
    if (streaming && abortRef.current) abortRef.current.abort();
    setMessages([]);
    setSessionId(`logis_${crypto.randomUUID()}`);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto p-1 space-y-3 min-h-0">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-teal-300 font-semibold mb-2">
              <Sparkles className="w-3 h-3" /> 추천 질문
            </div>
            <div className="flex flex-col gap-1.5">
              {SAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={streaming}
                  className="text-left text-xs px-3 py-2 rounded-md border border-ink-700 bg-ink-800 text-ink-200 hover:border-teal-500/60 hover:text-teal-200 transition disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-ink-500 italic px-1">
            <strong className="text-teal-300/90 font-semibold">inventory_lookup</strong> ·{' '}
            <strong className="text-teal-300/90 font-semibold">nearest_warehouses</strong> ·{' '}
            <strong className="text-teal-300/90 font-semibold">shortest_path</strong> 도구로
            그래프에서 답을 찾습니다. 자연어 SKU는 먼저 semantic_search로 sku_id를 확정한 뒤
            재고 조회로 체이닝됩니다.
          </p>
        </div>
      ) : (
        <div ref={transcriptRef} className="flex-1 overflow-y-auto p-1 space-y-2 min-h-0">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user'
              ? 'p-2 rounded-md bg-teal-500/10 border border-teal-500/30 text-xs text-ink-100'
              : 'p-2 rounded-md bg-ink-800 border border-ink-700 text-xs text-ink-200'}
            >
              {m.role === 'user' ? (
                <span className="whitespace-pre-wrap">{m.text}</span>
              ) : (
                <div className="prose-sm prose-invert max-w-none chat-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.text || (streaming ? '…' : '')}
                  </ReactMarkdown>
                </div>
              )}
              {m.role === 'assistant' && m.toolLogs && m.toolLogs.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-teal-300 hover:text-teal-200 flex items-center gap-1">
                    <Wrench className="w-3 h-3" /> 도구 호출 {m.toolLogs.length}건
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {m.toolLogs.map((t, j) => (
                      <li key={j} className="text-[10px] font-mono text-ink-400">
                        {j + 1}. {t.tool}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="border-t border-ink-700 mt-2 pt-2 flex gap-1.5 shrink-0"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
          placeholder="재고·거리·경로 질문…"
          className="flex-1 rounded border border-ink-700 bg-ink-800 text-ink-100 px-3 py-1.5 text-xs outline-none focus:border-teal-500 placeholder:text-ink-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || streaming}
          className="px-3 py-1.5 rounded bg-teal-500 text-ink-950 text-xs font-semibold disabled:bg-ink-700 disabled:text-ink-500 hover:bg-teal-400 transition"
          title="전송"
        >
          <Send className="w-3 h-3" />
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={reset}
            disabled={streaming}
            className="px-2 py-1.5 rounded border border-ink-700 bg-ink-800 text-ink-400 hover:border-rose-500/40 hover:text-rose-300 transition disabled:opacity-50"
            title="대화 초기화"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </form>
    </div>
  );
}
