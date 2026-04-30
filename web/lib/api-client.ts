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

// ─── Scenario I — Churn Risk Diagnosis ─────────────────────────────────────

export type AtRiskMember = {
  member_id: string;
  name_ko: string;
  tier: string;
  persona_id: string | null;
  persona_label_ko: string | null;
  churn_risk: number;
  recency_days: number;
  frequency: number;
  ltv_krw: number;
  last_purchase_at: string | null;
};

export type PersonaRiskBucket = {
  persona_id: string;
  persona_label_ko: string;
  total: number;
  at_risk: number;
  avg_churn_risk: number;
};

export type TierRiskBucket = {
  tier: string;
  total: number;
  at_risk: number;
  avg_churn_risk: number;
  avg_ltv_krw: number;
};

export type RecommendedCampaign = {
  campaign_id: string;
  name_ko: string;
  type: string;
  channel: string;
  target_persona_ids: string[];
  expected_response_rate: number;
};

export type ChurnDashboardResponse = {
  summary: {
    total_members: number;
    high_risk_count: number;
    high_risk_pct: number;
    vip_at_risk_count: number;
    avg_recency_days: number;
  };
  top_at_risk: AtRiskMember[];
  persona_breakdown: PersonaRiskBucket[];
  tier_breakdown: TierRiskBucket[];
  recommended_winback: RecommendedCampaign[];
  subgraph: Subgraph;
};

export type ChurnMemberDetailResponse = {
  member: AtRiskMember;
  transactions: {
    transaction_id: string;
    ts: string;
    amount_krw: number;
    sku_id: string | null;
    product_name_ko: string | null;
  }[];
  touchpoints: {
    touchpoint_id: string;
    type: string;
    ts: string;
    responded: boolean;
    campaign_id: string | null;
    campaign_name_ko: string | null;
  }[];
  response_rate: number;
  recommended_campaign: RecommendedCampaign | null;
  subgraph: Subgraph;
};

export async function churnDashboard(topK = 30): Promise<ChurnDashboardResponse> {
  const res = await fetch(`${BASE}/api/churn/dashboard?top_k=${topK}`);
  if (!res.ok) throw new Error(`churn dashboard failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function churnMember(memberId: string): Promise<ChurnMemberDetailResponse> {
  const res = await fetch(`${BASE}/api/churn/member/${encodeURIComponent(memberId)}`);
  if (!res.ok) throw new Error(`churn member failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Scenario J — Acquisition Channel ROI ──────────────────────────────────

export type CampaignRoi = {
  campaign_id: string;
  name_ko: string;
  channel: string;
  target_persona_ids: string[];
  cost_krw: number;
  sent: number;
  responded: number;
  response_rate: number;
  attributed_members: number;
  attributed_ltv_krw: number;
  roi: number;
};

export type ChannelRoi = {
  channel: string;
  sent: number;
  responded: number;
  response_rate: number;
  attributed_members: number;
  attributed_ltv_krw: number;
  cost_krw: number;
  roi: number;
};

export type PersonaChannelCell = {
  persona_id: string;
  persona_label_ko: string;
  channel: string;
  sent: number;
  responded: number;
  response_rate: number;
};

export type AcquisitionDashboardResponse = {
  summary: {
    total_campaigns: number;
    total_cost_krw: number;
    total_attributed_members: number;
    total_attributed_ltv_krw: number;
    blended_roi: number;
    best_channel: string | null;
    best_channel_roi: number;
  };
  campaigns: CampaignRoi[];
  channels: ChannelRoi[];
  persona_channel_matrix: PersonaChannelCell[];
};

export async function acquisitionDashboard(): Promise<AcquisitionDashboardResponse> {
  const res = await fetch(`${BASE}/api/acquisition/dashboard`);
  if (!res.ok) throw new Error(`acquisition dashboard failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Scenario K — Tier-up Path ─────────────────────────────────────────────

export type ProductLift = {
  sku_id: string;
  name_ko: string;
  domain: string | null;
  silver_buyers: number;
  gold_buyers: number;
  lift: number;
};

export type CategoryLift = {
  gs1_brick_code: string;
  name_ko: string;
  silver_buyers: number;
  gold_buyers: number;
  lift: number;
};

export type UpgradeCandidate = {
  member_id: string;
  name_ko: string;
  persona_id: string | null;
  persona_label_ko: string | null;
  ltv_krw: number;
  monetary_krw: number;
  frequency: number;
  recency_days: number;
  gap_to_gold_krw: number;
  churn_risk: number;
};

export type TierUpDashboardResponse = {
  summary: {
    silver_count: number;
    gold_count: number;
    silver_to_gold_ratio: number;
    candidates_count: number;
    avg_candidate_ltv_krw: number;
  };
  product_lift: ProductLift[];
  category_lift: CategoryLift[];
  upgrade_candidates: UpgradeCandidate[];
};

export async function tierUpDashboard(topK = 25): Promise<TierUpDashboardResponse> {
  const res = await fetch(`${BASE}/api/tier-up/dashboard?top_k=${topK}`);
  if (!res.ok) throw new Error(`tier-up dashboard failed: ${res.status} ${await res.text()}`);
  return res.json();
}
