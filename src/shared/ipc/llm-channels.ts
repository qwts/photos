import { z } from 'zod';

import { llmAskResponseSchema, llmEstimateResponseSchema, llmProvidersResponseSchema, llmSpendResponseSchema } from '../llm/contract.js';
import { llmProviderIdSchema } from '../llm/provider.js';
import type { ChannelDefinition, EventDefinition } from './channels.js';

// Opt-in LLM assistant IPC (ADR-0018 §7 / #393), split out of the central
// registry to keep it under the file-size budget (the original-policy-channels
// pattern). Cloud-only, per-feature opt-in. The API key crosses inbound on
// connect (renderer key entry → main custody), is validated against the
// provider before it is sealed, and never crosses back out. estimate/ask
// enforce the enable toggle, provider selection, key presence, and the
// protected-domain exclusion main-side.

function channel<TRequest extends z.ZodType, TResponse extends z.ZodType>(
  name: string,
  request: TRequest,
  response: TResponse,
): ChannelDefinition<TRequest, TResponse> {
  return { name, request, response };
}

function event<TPayload extends z.ZodType>(name: string, payload: TPayload): EventDefinition<TPayload> {
  return { name, payload };
}

export const llmChannels = {
  llmProviders: channel('llm:providers', z.object({}), llmProvidersResponseSchema),
  llmConnect: channel(
    'llm:connect',
    z.object({ providerId: llmProviderIdSchema, apiKey: z.string().min(1) }),
    z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  ),
  llmDisconnect: channel(
    'llm:disconnect',
    z.object({ providerId: llmProviderIdSchema }),
    z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  ),
  llmEstimate: channel('llm:estimate', z.object({ photoId: z.string().min(1), prompt: z.string().max(2000) }), llmEstimateResponseSchema),
  llmAsk: channel('llm:ask', z.object({ photoId: z.string().min(1), prompt: z.string().min(1).max(2000) }), llmAskResponseSchema),
  llmSpend: channel('llm:spend', z.object({}), llmSpendResponseSchema),
};

export const llmEvents = {
  // Visible whenever a request is in flight to a cloud provider (ADR-0018 §7):
  // `active` toggles the amber status-bar spinner; providerId names the callee.
  llmInflight: event('llm:inflight', z.object({ active: z.boolean(), providerId: llmProviderIdSchema.nullable() })),
};
