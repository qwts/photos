import { z } from 'zod';

import { llmProviderDescriptorSchema, llmProviderIdSchema } from './provider.js';

// Zod schemas for the LLM IPC surface (ADR-0018 §7), kept beside the domain
// types so the renderer↔main contract validates against the same shapes the
// cost math uses. Nothing here carries an API key — keys live in main-side
// custody and never cross the bridge on the way out.

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

/** Providers list + the currently selected provider (settings-scoped). */
export const llmProvidersResponseSchema = z.object({
  providers: z.array(llmProviderDescriptorSchema).readonly(),
  selectedProviderId: llmProviderIdSchema.nullable(),
});

/** Pre-request cost estimate for asking about one photo. `ok: false` carries why (disabled, no key, protected). */
export const llmEstimateResponseSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  providerId: llmProviderIdSchema.nullable(),
  modelId: z.string().nullable(),
  lowUsd: z.number().nonnegative().nullable(),
  highUsd: z.number().nonnegative().nullable(),
});

/** Result of an ask. `ok: false` carries a recoverable reason (offline, refused, quota, misconfigured). */
export const llmAskResponseSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  answer: z.string().nullable(),
  providerId: llmProviderIdSchema.nullable(),
  modelId: z.string().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  usage: tokenUsageSchema.nullable(),
});

/** Running per-provider spend, for the settings pane. */
export const llmSpendResponseSchema = z.object({
  totals: z
    .array(
      z.object({
        providerId: llmProviderIdSchema,
        totalUsd: z.number().nonnegative(),
        requests: z.number().int().nonnegative(),
      }),
    )
    .readonly(),
});
