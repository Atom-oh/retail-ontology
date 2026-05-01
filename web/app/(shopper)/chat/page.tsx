'use client';

import { useRef, useState } from 'react';
import { Download, FileText } from 'lucide-react';

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

// Phase chip palette — guardrail bookends + bedrock rounds + per-tool
// stages. Unknown phases (e.g. dynamic tool names) fall through to slate.
const PHASE_META: Record<string, { label: string; tone: string }> = {
  guardrail:     { label: '입력 가드레일',         tone: 'border-rose-500/40   bg-rose-500/10   text-rose-200' },
  memory:        { label: '메모리 저장',           tone: 'border-cyan-500/40   bg-cyan-500/10   text-cyan-200' },
  bedrock:       { label: 'Sonnet 4.6 추론',        tone: 'border-orange-500/40 bg-orange-500/10 text-orange-200' },
  'guardrail-out': { label: '응답 가드레일',       tone: 'border-rose-500/40   bg-rose-500/10   text-rose-200' },
};

function phaseToneFor(name: string): { label: string; tone: string } {
  if (PHASE_META[name]) return PHASE_META[name];
  // Tool phase chips share an emerald tone — distinguishes them from the
  // bedrock/guardrail bookends without exploding the palette.
  if (name.startsWith('tool:')) {
    return { label: name.replace('tool:', '🔧 '), tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' };
  }
  return { label: name, tone: 'border-slate-500/40 bg-slate-500/10 text-slate-200' };
}

export default function ChatPage() {
  const [sessionId] = useState(() => `sess_${crypto.randomUUID()}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolLog, setToolLog] = useState<{ tool: string; input: unknown }[]>([]);
  const [phases, setPhases] = useState<api.ChatPhase[]>([]);
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
    setPhases([]);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = '';
    const sessionToolLogs: { tool: string; input: unknown }[] = [];

    try {
      await api.chatStream(
        { session_id: sessionId, message: trimmed },
        (event) => {
          if (event.type === 'phase') {
            setPhases((p) => [...p, event.data]);
          } else if (event.type === 'log') {
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

  // ─── Export helpers ────────────────────────────────────────────────────

  function buildMarkdown(): string {
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const lines: string[] = [
      `# 대화형 에이전트 대화 기록`,
      ``,
      `- 세션: \`${sessionId}\``,
      `- 추출: ${stamp}`,
      `- 메시지 수: ${messages.length}`,
      ``,
      `---`,
      ``,
    ];
    messages.forEach((m, i) => {
      lines.push(`## ${i + 1}. ${m.role === 'user' ? '사용자' : '에이전트'}`);
      lines.push('');
      lines.push(m.text || '_(빈 메시지)_');
      lines.push('');
      if (m.role === 'assistant' && m.toolLogs && m.toolLogs.length > 0) {
        lines.push(`<details><summary>도구 호출 ${m.toolLogs.length}건</summary>`);
        lines.push('');
        m.toolLogs.forEach((t) => {
          lines.push(`- **${t.tool}** \`${JSON.stringify(t.input)}\``);
        });
        lines.push('');
        lines.push(`</details>`);
        lines.push('');
      }
    });
    return lines.join('\n');
  }

  function downloadMarkdown() {
    if (messages.length === 0) return;
    const md = buildMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${sessionId.replace('sess_', '')}-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Direct PDF download via jsPDF + html2canvas. Build a printable
  // container off-screen, capture as canvas (Korean OS fonts render as
  // pixels — no font embedding needed), paginate into A4 pages, save.
  // Dynamic import keeps the 200KB+ pdf libs out of the initial bundle.
  async function downloadPdf() {
    if (messages.length === 0) return;
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);

    const host = document.createElement('div');
    // Off-screen but laid out at a deterministic width so html2canvas
    // captures consistent pixel dimensions across viewports.
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = '760px';
    host.style.padding = '24px 28px';
    host.style.background = '#ffffff';
    host.style.color = '#111';
    host.style.fontFamily = "'Noto Sans KR', system-ui, sans-serif";
    host.style.fontSize = '13px';
    host.style.lineHeight = '1.65';

    const h1 = document.createElement('h1');
    h1.textContent = `대화 기록 — ${sessionId}`;
    h1.style.fontSize = '18px';
    h1.style.borderBottom = '2px solid #444';
    h1.style.paddingBottom = '6px';
    h1.style.margin = '0 0 12px';
    host.appendChild(h1);

    const meta = document.createElement('div');
    meta.style.fontSize = '11px'; meta.style.color = '#666'; meta.style.marginBottom = '14px';
    meta.textContent = `추출 ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 메시지 ${messages.length}`;
    host.appendChild(meta);

    messages.forEach((m, i) => {
      const wrap = document.createElement('div');
      wrap.style.margin = '8px 0 14px';
      wrap.style.padding = '10px 14px';
      wrap.style.border = '1px solid #d8dbe1';
      wrap.style.borderRadius = '8px';
      wrap.style.background = m.role === 'user' ? '#eef3fc' : '#fafbfc';
      wrap.style.pageBreakInside = 'avoid';

      const lbl = document.createElement('div');
      lbl.style.fontSize = '10px'; lbl.style.fontWeight = '700';
      lbl.style.color = '#666'; lbl.style.textTransform = 'uppercase';
      lbl.style.letterSpacing = '0.05em'; lbl.style.marginBottom = '4px';
      lbl.textContent = `${i + 1}. ${m.role === 'user' ? '사용자' : '에이전트'}`;
      wrap.appendChild(lbl);

      const body = document.createElement('div');
      body.style.whiteSpace = 'pre-wrap';
      body.style.wordBreak = 'break-word';
      body.style.fontSize = '12.5px';
      body.style.lineHeight = '1.6';
      body.textContent = m.text || '(빈 메시지)';
      wrap.appendChild(body);

      if (m.role === 'assistant' && m.toolLogs && m.toolLogs.length > 0) {
        const tools = document.createElement('div');
        tools.style.fontSize = '10px'; tools.style.color = '#555';
        tools.style.marginTop = '6px';
        const summary = document.createElement('div');
        summary.textContent = `도구 호출 ${m.toolLogs.length}건:`;
        tools.appendChild(summary);
        const ul = document.createElement('ul');
        ul.style.margin = '4px 0 0 18px'; ul.style.padding = '0';
        m.toolLogs.forEach((t) => {
          const li = document.createElement('li');
          const name = document.createElement('strong'); name.textContent = t.tool;
          li.appendChild(name);
          const code = document.createElement('span');
          code.style.fontFamily = 'ui-monospace, Menlo, monospace';
          code.style.fontSize = '10.5px';
          code.style.background = '#eef0f3';
          code.style.padding = '0 3px';
          code.style.borderRadius = '2px';
          code.style.marginLeft = '4px';
          code.textContent = JSON.stringify(t.input);
          li.appendChild(code);
          ul.appendChild(li);
        });
        tools.appendChild(ul);
        wrap.appendChild(tools);
      }
      host.appendChild(wrap);
    });

    document.body.appendChild(host);
    try {
      const canvas = await html2canvas(host, {
        scale: 2,                 // sharper for high-DPI screens / print zoom
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      // Paginate — slot the same image at offset position over multiple
      // pages. jsPDF clips by page, so each addPage shows the next slice.
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`chat-${sessionId.replace('sess_', '')}-${Date.now()}.pdf`);
    } finally {
      host.remove();
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 grid lg:grid-cols-[1fr_360px] gap-6">
      <section className="flex flex-col h-[calc(100vh-180px)]">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-bold">시나리오 B · 대화형 에이전트</h1>
            <p className="text-sm text-slate-500 mb-4">
              AgentCore Memory + Bedrock Converse tool-use. 우측 패널에 도구 호출이 실시간 표시됩니다.
            </p>
          </div>
          {messages.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={downloadMarkdown}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-300 transition"
                title="대화 기록을 .md 파일로 다운로드"
              >
                <FileText className="w-3.5 h-3.5" /> MD
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-300 transition"
                title="대화 기록을 .pdf 파일로 다운로드 (한글 OS 폰트)"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          )}
        </div>

        {/* Input form — placed at the top so the layout matches the
            search and insights pages (form / chips / progress / output). */}
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
          className="flex gap-2 mb-3"
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

        {/* Streaming phase strip — visible while the agent is working,
            collapsed once the stop event arrives. */}
        {(streaming || phases.length > 0) && (
          <div className="mb-4 rounded-lg border border-slate-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-ink-400 font-semibold mb-2 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse-soft" />
              에이전트 진행 중 — {phases.length}단계
            </div>
            <ol className="flex flex-wrap items-center gap-2">
              {phases.map((p, i) => {
                const meta = phaseToneFor(p.name);
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border ${meta.tone}`}
                  >
                    <span className="text-[9px] opacity-60">{i + 1}.</span>
                    <span className="font-semibold">{meta.label}</span>
                    {p.detail && <span className="opacity-70">— {p.detail}</span>}
                  </li>
                );
              })}
              {streaming && (
                <li className="text-[11px] font-mono px-2 py-1 rounded border border-slate-300/30 bg-slate-300/5 text-slate-400 animate-pulse-soft">
                  다음 단계…
                </li>
              )}
            </ol>
          </div>
        )}

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

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
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
