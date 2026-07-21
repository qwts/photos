import type { ModelPrice } from './pricing.js';

// Pure cost math for the transparency surface (ADR-0018 §7). No I/O, no
// provider SDKs — just arithmetic on token counts, so every number the user
// sees is reproducible and testable. Provider adapters normalise their own
// usage reports into `TokenUsage` before calling in here.

/**
 * Normalised token usage. `inputTokens` is the TOTAL prompt tokens including
 * any that hit the cache; `cachedInputTokens` is the subset billed at the
 * reduced cache-read rate. `outputTokens` includes reasoning/thinking tokens,
 * which providers bill as output. Adapters map their provider-specific usage
 * shape (Anthropic's `cache_read_input_tokens`, OpenAI's
 * `prompt_tokens_details.cached_tokens`, etc.) onto this convention.
 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

const PER_MILLION = 1_000_000;

/** Exact USD cost of a completed request from its reported usage. */
export function costUsd(price: ModelPrice, usage: TokenUsage): number {
  const cached = Math.max(0, Math.min(usage.cachedInputTokens, usage.inputTokens));
  const uncachedInput = usage.inputTokens - cached;
  const output = Math.max(0, usage.outputTokens);
  return (uncachedInput * price.inputPerMillion + cached * price.cachedInputPerMillion + output * price.outputPerMillion) / PER_MILLION;
}

export interface CostEstimateInput {
  /** Counted prompt tokens (image + typed prompt + display-metadata context) for this request. */
  readonly inputTokens: number;
  /** Floor for the model's reply length, tokens. */
  readonly minOutputTokens: number;
  /** The request's `max_tokens` ceiling, tokens. */
  readonly maxOutputTokens: number;
}

export interface CostRange {
  readonly low: number;
  readonly high: number;
}

/**
 * Pre-request estimate range. A single ask has no cache to draw on, so input
 * is priced at the full (uncached) rate at both ends; the spread is the
 * unknown reply length, from `minOutputTokens` (low) to the `max_tokens`
 * ceiling (high). Honest by construction: it never assumes a cache discount it
 * cannot guarantee, and the high end reflects the real worst case the user
 * could be billed.
 */
export function estimateCostRange(price: ModelPrice, input: CostEstimateInput): CostRange {
  const inputCost = (Math.max(0, input.inputTokens) * price.inputPerMillion) / PER_MILLION;
  const minOut = Math.max(0, Math.min(input.minOutputTokens, input.maxOutputTokens));
  const maxOut = Math.max(0, input.maxOutputTokens);
  return {
    low: inputCost + (minOut * price.outputPerMillion) / PER_MILLION,
    high: inputCost + (maxOut * price.outputPerMillion) / PER_MILLION,
  };
}

/**
 * Format a USD amount for the cost hint. Scales precision to magnitude so
 * fractions-of-a-cent asks stay legible: "$1.20", "$0.012", "$0.0004". A
 * positive amount that would round to nothing shows "<$0.0001" rather than a
 * misleading "$0.00".
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    return '$0.00';
  }
  if (amount >= 1) {
    return `$${amount.toFixed(2)}`;
  }
  if (amount >= 0.01) {
    return `$${amount.toFixed(3)}`;
  }
  if (amount < 0.0001) {
    return '<$0.0001';
  }
  return `$${amount.toFixed(4)}`;
}

/** Format an estimate range: a single value when the ends round equal, else "$low–$high". */
export function formatUsdRange(range: CostRange): string {
  const low = formatUsd(range.low);
  const high = formatUsd(range.high);
  return low === high ? low : `${low}–${high}`;
}
