'use client';

import { useRef, useState } from 'react';

import * as api from '@/lib/api-client';
import { MarkdownView } from '@/components/MarkdownView';

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  toolLogs?: { tool: string; input: unknown }[];
};

// 10 demo prompts spanning the 5-persona spine (임산부 / 4세 아이 / 캠퍼 /
// 민감성 피부 / 글루텐 알레르기) + membership + price + seasonal hooks.
// Click → instant send so the demo flow stays one-touch.
const SUGGESTED_PROMPTS: { label: string; persona: string }[] = [
  { label: '임신 6개월, 카페인 없는 따뜻한 음료 추천',           persona: '임산부' },
  { label: '4세 아이 간식, 글루텐프리·견과류 없이',                persona: '4세 아이' },
  { label: '다음 주 캠핑 BBQ 식자재 챙겨줘',                       persona: '캠퍼' },
  { label: '민감성 피부에 부담 없는 클렌저',                       persona: '민감성 피부' },
  { label: '글루텐 알레르기인데 라면 대신 뭐 먹을까?',             persona: '글루텐' },
  { label: '시카 성분 들어간 가성비 좋은 토너',                    persona: '민감성 피부' },
  { label: '추석 선물세트 5만원 이하로 추천',                      persona: '계절성' },
  { label: '임산부에게 안전한 비건 화장품',                        persona: '임산부' },
  { label: '신학기 어린이 영양제 추천',                            persona: '4세 아이' },
  { label: 'VIP 회원인데 최근 구매가 줄었어, 신상 추천',           persona: '멤버십' },
];

const PERSONA_TONE: Record<string, string> = {
  '임산부':       'border-pink-500/40   bg-pink-500/10   text-pink-200',
  '4세 아이':     'border-amber-500/40  bg-amber-500/10  text-amber-200',
  '캠퍼':         'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  '민감성 피부':  'border-rose-500/40   bg-rose-500/10   text-rose-200',
  '글루텐':       'border-violet-500/40 bg-violet-500/10 text-violet-200',
  '계절성':       'border-orange-500/40 bg-orange-500/10 text-orange-200',
  '멤버십':       'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

export default function ChatPage() {
  const [sessionId] = useState(() => `sess_${crypto.randomUUID()}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolLog, setToolLog] = useState<{ tool: string; input: unknown }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Single entry point used by both the input box and the suggested-prompt
  // chips. `text` is the message to send; we push it onto messages, kick the
  // SSE stream, and feed delta/log/stop events into UI state.
  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    const userMsg: ChatMessage = { role: 'user', text: trimmed };
    setMessages((m) => [...m, userMsg, { role: 'assistant', text: '', toolLogs: [] }]);
    setInput('');
    setStreaming(true);
    setToolLog([]);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = '';
    const sessionToolLogs: { tool: string; input: unknown }[] = [];

    try {
      await api.chatStream(
        { session_id: sessionId, message: trimmed },
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

        {/* Suggested prompts — clickable chips that auto-send. Hidden once
            the conversation has started so the chat history isn't cluttered. */}
        {messages.length === 0 && (
          <div className="mb-5">
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">
              추천 질문 — 클릭하면 바로 전송됩니다
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {SUGGESTED_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={streaming}
                  onClick={() => sendMessage(p.label)}
                  className="group flex items-start gap-2 text-left px-3 py-2.5 rounded-lg border border-slate-300/40 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-brand-500/60 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition disabled:opacity-50"
                >
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${
                      PERSONA_TONE[p.persona] ?? 'border-slate-500/40 bg-slate-500/10 text-slate-300'
                    }`}
                  >
                    {p.persona}
                  </span>
                  <span className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed group-hover:text-brand-700 dark:group-hover:text-brand-200">
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-4 mb-3 pr-2">
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
              {m.role === 'user'
                ? <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</p>
                : <MarkdownView text={m.text || (streaming ? '…' : '')} />}
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
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
