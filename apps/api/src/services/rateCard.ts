/** Model rate card (USD per million tokens), keyed by modelProfile — the
 * worker routes profiles to tiers (CLAUDE.md model routing), so cost
 * estimates follow the same mapping. Prices as of 2026-10 (Anthropic API):
 * Haiku 4.5 $1/$5 · Sonnet 5.5 $2/$10 · Opus 5.5 $4/$20. Estimates only —
 * cache reads and actual serving-model fallbacks are not modelled.
 * Override via RATE_CARD_JSON env if prices move. */

export type Rate = { inUsdPerMTok: number; outUsdPerMTok: number };

const DEFAULT_RATES: Record<string, Rate> = {
  extraction: { inUsdPerMTok: 1, outUsdPerMTok: 5 }, // Haiku tier
  default: { inUsdPerMTok: 2, outUsdPerMTok: 10 }, // Sonnet tier
  reasoning: { inUsdPerMTok: 4, outUsdPerMTok: 20 }, // Opus tier
  none: { inUsdPerMTok: 0, outUsdPerMTok: 0 }, // deterministic
};

export function rateCard(): Record<string, Rate> {
  const raw = process.env.RATE_CARD_JSON;
  if (!raw) return DEFAULT_RATES;
  try {
    return { ...DEFAULT_RATES, ...(JSON.parse(raw) as Record<string, Rate>) };
  } catch {
    return DEFAULT_RATES;
  }
}

/** Estimated cost in USD cents for a token usage under a profile. */
export function estimateCostCents(
  profile: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const r = rateCard()[profile] ?? DEFAULT_RATES.default!;
  return Math.round(((inputTokens * r.inUsdPerMTok + outputTokens * r.outUsdPerMTok) / 1_000_000) * 100);
}
