'use client';

import { useRef, useState } from 'react';

import * as api from '@/lib/api-client';

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  toolLogs?: { tool: string; input: unknown }[];
};

export default function ChatPage() {
  const [sessionId] = useState(() => `sess_${crypto.randomUUID()}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolLog, setToolLog] = useState<{ tool: string; input: unknown }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg: ChatMessage = { role: 'user', text: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setStreaming(true);
    setToolLog([]);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = '';
    const sessionToolLogs: { tool: string; input: unknown }[] = [];

    setMessages((m) => [...m, { role: 'assistant', text: '', toolLogs: [] }]);

    try {
      await api.chatStream(
        { session_id: sessionId, message: userMsg.text },
        (event) => {
          if (event.type === 'log') {
            sessionToolLogs.push(event.data);
            setToolLog((logs) => [...logs, event.data]);
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

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 grid lg:grid-cols-[1fr_360px] gap-6">
      <section className="flex flex-col h-[calc(100vh-180px)]">
        <h1 className="text-2xl font-bold">시나리오 B · 대화형 에이전트</h1>
        <p className="text-sm text-slate-500 mb-4">
          AgentCore Memory + Bedrock Converse tool-use. 우측 패널에 도구 호출이 실시간 표시됩니다.
        </p>

        <div className="flex-1 overflow-y-auto space-y-4 mb-3 pr-2">
          {messages.length === 0 && (
            <div className="text-sm text-slate-400">
              예: &ldquo;다음 주 캠핑 가는데 필요한 걸 챙겨줘&rdquo;
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg ${
                m.role === 'user'
                  ? 'bg-brand-50 dark:bg-brand-900/30 ml-12'
                  : 'bg-slate-100 dark:bg-slate-800 mr-12'
              }`}
            >
              <div className="text-xs font-semibold mb-1 opacity-60">
                {m.role === 'user' ? '사용자' : '에이전트'}
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</p>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming}
            placeholder="메시지를 입력하세요"
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="px-5 py-2 rounded-lg bg-brand-600 text-white disabled:bg-slate-300 hover:bg-brand-500 transition"
          >
            {streaming ? '응답 중…' : '전송'}
          </button>
        </form>
      </section>

      <aside className="border-l border-slate-200 dark:border-slate-700 pl-4">
        <h2 className="text-sm font-semibold mb-3">도구 호출 로그 (Gateway)</h2>
        {toolLog.length === 0 && (
          <p className="text-xs text-slate-400">아직 도구 호출이 없습니다.</p>
        )}
        <ul className="space-y-2">
          {toolLog.map((t, i) => (
            <li
              key={i}
              className="p-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <div className="font-mono text-xs text-brand-600">{t.tool}</div>
              <pre className="text-xs text-slate-500 overflow-x-auto whitespace-pre-wrap break-all mt-1">
                {JSON.stringify(t.input, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
