import { z } from 'zod';

// LLM provider contract (ADR-0018 §7). Mirrors the storage-provider descriptor
// (ADR-0011, `shared/backup/provider-descriptor.ts`): a small, typed seam the
// renderer and tests build against without any credentials. v1 is cloud-only
// and per-feature opt-in; adding a provider is one enum entry plus a concrete
// adapter — "additive", per the ADR.

/** The cloud LLM providers wired in v1. Additive: extend the enum to add one. */
export const llmProviderIdSchema = z.enum(['anthropic', 'openai', 'xai']);

/**
 * Generative features gated behind per-feature opt-in (ADR-0018 §7). Semantic
 * *search* (§2–§6) is a separate, fully-local subsystem and is not an LLM
 * feature. `qa` (ask-about-this-photo) is the v1 slice; `caption` follows.
 */
export const llmFeatureSchema = z.enum(['caption', 'qa']);

export const llmProviderCapabilitiesSchema = z.object({
  /** Features this provider's wired adapter can serve. */
  features: z.array(llmFeatureSchema).min(1).readonly(),
  /** True when the provider accepts the mid-size image derivative (all v1 providers do). */
  vision: z.boolean(),
});

export const llmProviderDescriptorSchema = z.object({
  id: llmProviderIdSchema,
  label: z.string().min(1),
  capabilities: llmProviderCapabilitiesSchema,
  /** True once an API key is in custody and usable — the "no key configured" surface. */
  available: z.boolean(),
  /** Human reason `available` is false (e.g. "No API key configured."), else null. */
  unavailableReason: z.string().nullable(),
});

export type LlmProviderId = z.output<typeof llmProviderIdSchema>;
export type LlmFeature = z.output<typeof llmFeatureSchema>;
export type LlmProviderCapabilities = z.output<typeof llmProviderCapabilitiesSchema>;
export type LlmProviderDescriptor = z.output<typeof llmProviderDescriptorSchema>;

/** Stable display labels for each provider, for settings and the in-flight indicator. */
export const LLM_PROVIDER_LABELS: Readonly<Record<LlmProviderId, string>> = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI Grok',
});
