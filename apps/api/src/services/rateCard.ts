/** Model rate card (USD per million tokens), keyed by modelProfile — the
 * worker routes profiles to tiers (CLAUDE.md model routing), so cost
 * estimates follow the same mapping. Prices as of 2026-10 (Anthropic API):
 *   Haiku 4.5  $1 in / $5 out  · cache write $1.25 · cache read $0.10
 *   Sonnet 5.5 $2 in / $10 out · cache write $2.50 · cache read $0.20
 *   Opus 5.5   $4 in / $20 out · cache write $5.00 · cache read $0.20
 * (note Opus cache reads are 0.05× its input rate, not 0.1× — per-tier
 * cache rates are explicit here for exactly that reason). The worker stores
 * RAW token splits on agent_run (uncached input / output / cache written /
 * cache read); ALL pricing happens here at read time, so a price move is a
 * RATE_CARD_JSON override — never a data rewrite. Serving-model fallbacks
 * are not modelled. */

export type Rate = {
  inUsdPerMTok: number;
  outUsdPerMTok: number;
  cacheWriteUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
};

const DEFAULT_RATES: Record<string, Rate> = {
  extraction: { inUsdPerMTok: 1, outUsdPerMTok: 5, cacheWriteUsdPerMTok: 1.25, cacheReadUsdPerMTok: 0.1 }, // Haiku tier
  default: { inUsdPerMTok: 2, outUsdPerMTok: 10, cacheWriteUsdPerMTok: 2.5, cacheReadUsdPerMTok: 0.2 }, // Sonnet tier
  reasoning: { inUsdPerMTok: 4, outUsdPerMTok: 20, cacheWriteUsdPerMTok: 5, cacheReadUsdPerMTok: 0.2 }, // Opus tier
  none: { inUsdPerMTok: 0, outUsdPerMTok: 0, cacheWriteUsdPerMTok: 0, cacheReadUsdPerMTok: 0 }, // deterministic
};

export function rateCard(): Record<string, Rate> {
  const raw = process.env.RATE_CARD_JSON;
  if (!raw) return DEFAULT_RATES;
  try {
    const overrides = JSON.parse(raw) as Record<string, Partial<Rate>>;
    const merged: Record<string, Rate> = { ...DEFAULT_RATES };
    for (const [k, v] of Object.entries(overrides))
      merged[k] = { ...(merged[k] ?? DEFAULT_RATES.default!), ...v };
    return merged;
  } catch {
    return DEFAULT_RATES;
  }
}

/** Estimated cost in USD cents for a raw token split under a profile. */
export function estimateCostCents(
  profile: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0,
): number {
  const r = rateCard()[profile] ?? DEFAULT_RATES.default!;
  return Math.round(
    ((inputTokens * r.inUsdPerMTok +
      outputTokens * r.outUsdPerMTok +
      cacheWriteTokens * r.cacheWriteUsdPerMTok +
      cacheReadTokens * r.cacheReadUsdPerMTok) /
      1_000_000) *
      100,
  );
}
