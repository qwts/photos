import { z } from 'zod';

import { llmFeatureSchema, llmProviderIdSchema, type LlmFeature, type LlmProviderId } from './provider.js';

// Committed pricing manifest (ADR-0018 §7 "cost hinting"). This is the single
// source of truth for what an LLM request costs. Every rate is recorded with
// its `source` URL and the `asOf` date it was captured, so the numbers are
// auditable and a price change is a one-line manifest edit — never buried in
// code. Rates are US dollars per 1,000,000 tokens.
//
// Provenance:
//  - Anthropic: platform.claude.com API reference (Opus/Sonnet/Haiku tiers).
//    Cache-read input bills ~0.1× input.
//  - OpenAI:    developers.openai.com/api/docs/pricing (standard tier).
//  - xAI Grok:  docs.x.ai/docs/models (base <200K-context tier; a higher
//               ≥200K tier exists but our payloads — one ≤1024px image plus a
//               short prompt — stay well under it).
//
// Re-verify each provider's block against its source when a rate may have
// moved; bump `asOf` on the block when you do.

export const modelPriceSchema = z.object({
  /** Exact API model id billed. */
  modelId: z.string().min(1),
  /** USD per 1M uncached input tokens. */
  inputPerMillion: z.number().nonnegative(),
  /** USD per 1M cache-read input tokens (reduced rate). */
  cachedInputPerMillion: z.number().nonnegative(),
  /** USD per 1M output tokens — includes reasoning/thinking tokens, which every provider bills as output. */
  outputPerMillion: z.number().nonnegative(),
});

export const providerPricingSchema = z.object({
  providerId: llmProviderIdSchema,
  /** Official pricing page the rates were read from. */
  source: z.string().url(),
  /** ISO date (YYYY-MM-DD) the rates were captured. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  models: z.array(modelPriceSchema).min(1).readonly(),
  /**
   * Which model each feature uses. Model tiering is a provider-implementation
   * detail, bump-able without an ADR (§7): captions target a fast tier, Q&A a
   * balanced tier.
   */
  featureModel: z.record(llmFeatureSchema, z.string().min(1)),
});

export type ModelPrice = z.output<typeof modelPriceSchema>;
export type ProviderPricing = z.output<typeof providerPricingSchema>;

const ANTHROPIC_PRICING: ProviderPricing = {
  providerId: 'anthropic',
  source: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  asOf: '2026-07-21',
  models: [
    // Q&A (balanced tier). Sonnet 5 standard rate; an intro rate ($2/$10) runs
    // through 2026-08-31 — the standard rate is recorded so the estimate never
    // under-states once the intro lapses.
    { modelId: 'claude-sonnet-5', inputPerMillion: 3.0, cachedInputPerMillion: 0.3, outputPerMillion: 15.0 },
    // Captions (fast tier).
    { modelId: 'claude-haiku-4-5', inputPerMillion: 1.0, cachedInputPerMillion: 0.1, outputPerMillion: 5.0 },
  ],
  featureModel: { qa: 'claude-sonnet-5', caption: 'claude-haiku-4-5' },
};

const OPENAI_PRICING: ProviderPricing = {
  providerId: 'openai',
  source: 'https://developers.openai.com/api/docs/pricing',
  asOf: '2026-07-21',
  models: [
    // Q&A (balanced tier).
    { modelId: 'gpt-5.6-terra', inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15.0 },
    // Captions (fast tier).
    { modelId: 'gpt-5.6-luna', inputPerMillion: 1.0, cachedInputPerMillion: 0.1, outputPerMillion: 6.0 },
  ],
  featureModel: { qa: 'gpt-5.6-terra', caption: 'gpt-5.6-luna' },
};

const XAI_PRICING: ProviderPricing = {
  providerId: 'xai',
  source: 'https://docs.x.ai/docs/models',
  asOf: '2026-07-21',
  models: [
    // Q&A (balanced/flagship tier), base <200K-context rate.
    { modelId: 'grok-4.5', inputPerMillion: 2.0, cachedInputPerMillion: 0.3, outputPerMillion: 6.0 },
    // Captions (fast/cheaper tier), base <200K-context rate.
    { modelId: 'grok-4.3', inputPerMillion: 1.25, cachedInputPerMillion: 0.2, outputPerMillion: 2.5 },
  ],
  featureModel: { qa: 'grok-4.5', caption: 'grok-4.3' },
};

const PRICING: Readonly<Record<LlmProviderId, ProviderPricing>> = Object.freeze({
  anthropic: ANTHROPIC_PRICING,
  openai: OPENAI_PRICING,
  xai: XAI_PRICING,
});

/** The whole committed manifest, validated. Throws if any block is malformed. */
export function allProviderPricing(): Readonly<Record<LlmProviderId, ProviderPricing>> {
  for (const block of Object.values(PRICING)) {
    providerPricingSchema.parse(block);
  }
  return PRICING;
}

/** Pricing block for a provider. */
export function pricingFor(providerId: LlmProviderId): ProviderPricing {
  return PRICING[providerId];
}

/** Per-token price for a specific model, or null if the provider does not bill that model. */
export function modelPriceFor(providerId: LlmProviderId, modelId: string): ModelPrice | null {
  return PRICING[providerId].models.find((m) => m.modelId === modelId) ?? null;
}

/** Per-token price for the model a feature uses on a provider. */
export function featureModelPrice(providerId: LlmProviderId, feature: LlmFeature): ModelPrice {
  const modelId = PRICING[providerId].featureModel[feature];
  const price = modelId === undefined ? null : modelPriceFor(providerId, modelId);
  if (price === null) {
    // A featureModel entry with no matching model row is a manifest bug, caught by allProviderPricing() tests.
    throw new Error(`No price for ${providerId} feature ${feature}`);
  }
  return price;
}
