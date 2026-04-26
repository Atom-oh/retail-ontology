/**
 * API client for FastAPI endpoints (api/routers).
 * Base URL: same origin (CloudFront → ALB listener routes /api/* → tg-api).
 * In dev, set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 to hit local FastAPI.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type SearchHit = {
  sku_id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
};

export type GraphNode = { data: { id: string } & Record<string, unknown> };
export type GraphEdge = { data: { source: string; target: string; label?: string } & Record<string, unknown> };
export type Subgraph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type SearchResponse = {
  hits: SearchHit[];
  subgraph: Subgraph;
  query_echo: string;
};

export async function search(
  q: string,
  opts: { topK?: number; persona?: string; includeSubgraph?: boolean } = {},
): Promise<SearchResponse> {
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q,
      top_k: opts.topK ?? 10,
      persona: opts.persona,
      include_subgraph: opts.includeSubgraph ?? true,
    }),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export type ChatEvent =
  | { type: 'log'; data: { tool: string; input: unknown } }
  | { type: 'delta'; data: { text: string } }
  | { type: 'guardrail'; data: { action: string } }
  | { type: 'stop'; data: { final: string } };

/**
 * SSE consumer for POST /api/chat.
 * EventSource only supports GET, so we use fetch + ReadableStream parser.
 */
export async function chatStream(
  body: { session_id: string; message: string; actor_id?: string },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const evt = parseSseFrame(frame);
      if (evt) onEvent(evt);
    }
  }
}

function parseSseFrame(raw: string): ChatEvent | null {
  let type = '';
  let dataLine = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) type = line.slice(7).trim();
    else if (line.startsWith('data: ')) dataLine = line.slice(6);
  }
  if (!type || !dataLine) return null;
  try {
    return { type, data: JSON.parse(dataLine) } as ChatEvent;
  } catch {
    return null;
  }
}

export type InsightsResponse = {
  answer_ko: string;
  chart_spec: { type: string; title: string; data: { label: string; value: number }[] };
  drill_down_subgraph: Subgraph;
};

export async function insights(q: string, periodDays = 28): Promise<InsightsResponse> {
  const res = await fetch(`${BASE}/api/insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, period_days: periodDays }),
  });
  if (!res.ok) throw new Error(`insights failed: ${res.status}`);
  return res.json();
}
