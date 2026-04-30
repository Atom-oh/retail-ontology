'use client';

import { useState } from 'react';
import { Store, Sparkles, ShoppingCart, Trophy, AlertTriangle } from 'lucide-react';

import * as api from '@/lib/api-client';
import { useActivePersona } from '@/lib/persona-context';

const SAMPLE_QUERIES = [
  '시카 진정 크림',
  '임산부도 안전한 비건 토너',
  '운동 후 단백질 25g 이상 음료',
  '글루텐프리 어린이 간식',
  '캠핑가서 먹기 좋은 간편식',
  '바쿠치올 안티에이징 세럼',
  '저칼로리 도시락',
  '프로폴리스 면역 보충제',
];

export default function PriceComparePage() {
  const { active: activePersona } = useActivePersona();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.PriceCompareResponse | null>(null);

  async function run(query: string) {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.priceCompare(query, { topK: 3, persona: activePersona?.id });
      setResult(res); setQ(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-ink-700 bg-ink-900 flex items-center px-6">
        <div className="text-xs text-ink-400">시나리오 G · 가격·가용성 비교</div>
        <span className="ml-3 text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
          4 채널 × N SKU 매트릭스 + 페르소나 가중치
        </span>
      </header>

      <div className="flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-50 mb-1 flex items-center gap-2">
            <Store className="w-6 h-6 text-cyan-400" /> 가격·가용성 비교
          </h1>
          <p className="text-sm text-ink-400">
            자연어 → 추천 SKU → CU·이마트·올리브영·마컬 4채널 가격/할인/재고 매트릭스 → 페르소나 선호 채널 가중치로 &ldquo;지금 사기 좋은 곳&rdquo; 추천
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(q.trim()); }}
          className="flex gap-2"
        >
          <div className="flex-1 relative">
            <ShoppingCart className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="자연어 쿼리를 입력하세요"
              className="w-full rounded-md border border-ink-700 bg-ink-900 text-ink-100 pl-9 pr-4 py-2.5 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 placeholder:text-ink-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="px-5 py-2.5 rounded-md bg-cyan-500 text-ink-950 font-semibold disabled:bg-ink-700 disabled:text-ink-500 hover:bg-cyan-400 transition"
          >
            {loading ? '비교 중…' : '비교'}
          </button>
        </form>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-ink-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> 추천 쿼리:
          </span>
          {SAMPLE_QUERIES.map((qq) => (
            <button
              key={qq}
              onClick={() => { setQ(qq); run(qq); }}
              className="text-xs px-3 py-1 rounded-full border border-ink-700 bg-ink-800 text-ink-300 hover:border-cyan-500 hover:text-cyan-300 transition"
            >
              {qq}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-sm">
            오류: {error}
          </div>
        )}

        {loading && !result && !error && (
          <div className="p-3 rounded-md border border-ink-700 bg-ink-900 text-xs text-ink-400 italic">
            의미 검색 → 채널 매트릭스 합성 중…
          </div>
        )}

        {result && (
          <div className="space-y-5">
            {result.persona_label && (
              <div className="text-xs text-ink-400">
                페르소나 가중치 적용:{' '}
                <span className="font-semibold text-orange-300">{result.persona_label}</span>
              </div>
            )}
            {result.candidates.length === 0 && (
              <div className="p-4 rounded-md border border-dashed border-ink-700 text-sm text-ink-500 italic">
                일치하는 상품이 없습니다.
              </div>
            )}
            {result.candidates.map((c) => (
              <article
                key={c.sku_id}
                className="rounded-lg border border-ink-700 bg-ink-800 p-5 hover:border-cyan-500/40 transition"
              >
                <div className="flex items-start gap-3 mb-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold text-ink-100 truncate">{c.name}</h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="font-mono text-[10px] text-ink-400">{c.sku_id}</span>
                      {c.domain && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink-900 text-ink-300 border border-ink-700">
                          {c.domain}
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-ink-400">
                        기준가 ₩{c.base_price_krw.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {c.best_channel_id && (
                    <div className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs flex items-center gap-2">
                      <Trophy className="w-3.5 h-3.5 text-cyan-300" />
                      <div>
                        <div className="text-cyan-200 font-semibold">
                          추천: {c.channels.find((ch) => ch.channel_id === c.best_channel_id)?.channel_name_ko}
                        </div>
                        <div className="text-[10px] text-cyan-300/80">{c.best_channel_reason}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {c.channels.map((ch) => {
                    const isBest = c.best_channel_id === ch.channel_id;
                    return (
                      <div
                        key={ch.channel_id}
                        className={[
                          'rounded-md border p-3 transition',
                          !ch.in_stock
                            ? 'border-ink-700 bg-ink-950 opacity-60'
                            : isBest
                              ? 'border-cyan-500/60 bg-cyan-500/5 shadow-md shadow-cyan-500/10'
                              : 'border-ink-700 bg-ink-900',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-semibold text-ink-100">{ch.channel_name_ko}</div>
                          {!ch.available && (
                            <span title="이 채널 미입점" className="text-[10px] font-mono text-ink-500">미입점</span>
                          )}
                          {ch.available && !ch.in_stock && (
                            <span className="flex items-center gap-1 text-[10px] font-mono text-amber-300">
                              <AlertTriangle className="w-3 h-3" /> 재고 없음
                            </span>
                          )}
                          {isBest && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/40">
                              BEST
                            </span>
                          )}
                        </div>
                        <div className="space-y-1">
                          {ch.discount_pct > 0 && ch.in_stock ? (
                            <>
                              <div className="text-[11px] text-ink-500 font-mono line-through">
                                ₩{ch.list_price_krw.toLocaleString()}
                              </div>
                              <div className="text-base font-bold text-ink-100 font-mono">
                                ₩{ch.final_price_krw.toLocaleString()}
                                <span className="ml-2 text-[11px] text-rose-300">-{ch.discount_pct}%</span>
                              </div>
                            </>
                          ) : (
                            <div className="text-base font-bold text-ink-100 font-mono">
                              ₩{ch.list_price_krw.toLocaleString()}
                            </div>
                          )}
                          {ch.persona_bonus > 0 && (
                            <div className="text-[10px] text-orange-300">
                              페르소나 보너스 +{(ch.persona_bonus * 100).toFixed(0)}%
                            </div>
                          )}
                          <div className="text-[10px] font-mono text-ink-400">score {ch.score.toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
