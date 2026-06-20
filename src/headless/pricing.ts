// USD per 1,000,000 tokens. EDIT as prices change — exact model-ID match only, so dated snapshots
// (gpt-5.5-2026-04-23) and variants (gpt-5.5-pro) won't be silently mispriced. Unlisted model -> cost null.
// Verified Jun 2026 from public pricing trackers; confirm against your OpenAI/Anthropic dashboard.
export interface Price { in: number; out: number }   // reasoning tokens bill at the output rate

export const PRICES: Record<string, Price> = {
  'gpt-5.5': { in: 5.0, out: 30.0 },
  'gpt-5.4-nano': { in: 0.2, out: 1.25 },
  // add more here as you benchmark them, e.g.:
  // 'gpt-5.4': { in: ?, out: ? },
  // 'claude-opus-4-8': { in: ?, out: ? },
}

/** Cost in USD for the given token counts, or null if the model has no price entry. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICES[model]
  return p ? (inputTokens * p.in + outputTokens * p.out) / 1e6 : null
}
