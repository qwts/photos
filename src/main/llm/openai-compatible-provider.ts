import OpenAI from 'openai';

import type { TokenUsage } from '../../shared/llm/cost.js';
import { pricingFor } from '../../shared/llm/pricing.js';
import type { LlmProviderCapabilities, LlmProviderId } from '../../shared/llm/provider.js';
import { LlmRefusalError, LlmRequestError, type LlmProvider, type LlmQaCall, type LlmQaOutcome } from './provider.js';
import { composePrompt, SYSTEM_PROMPT } from './prompt.js';

// One adapter for every OpenAI-compatible chat API. OpenAI is the reference
// endpoint; xAI Grok speaks the same protocol at a different base URL, so it is
// the same code with a different `baseUrl` and model — "additive", per
// ADR-0018 §7. Usage is normalised onto the shared TokenUsage shape.

interface OpenAiChatBody {
  readonly model: string;
  readonly messages: unknown[];
  readonly max_tokens?: number;
  readonly max_completion_tokens?: number;
}
interface OpenAiChatResponse {
  readonly choices: ReadonlyArray<{
    readonly message: { readonly content: string | null; readonly refusal?: string | null };
    readonly finish_reason: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_tokens_details?: { readonly cached_tokens?: number | null } | null;
  } | null;
}
export interface OpenAiClientLike {
  readonly chat: { readonly completions: { create(body: OpenAiChatBody): Promise<OpenAiChatResponse> } };
  readonly models: { list(): Promise<unknown> };
}
export type OpenAiClientFactory = (apiKey: string) => OpenAiClientLike;

export interface OpenAiCompatibleConfig {
  readonly id: LlmProviderId;
  /** Non-default base URL for OpenAI-compatible providers (e.g. xAI). Omit for OpenAI itself. */
  readonly baseUrl?: string;
  /** Newer OpenAI models take `max_completion_tokens`; xAI takes `max_tokens`. */
  readonly tokenParam: 'max_tokens' | 'max_completion_tokens';
}

function normaliseUsage(usage: OpenAiChatResponse['usage']): TokenUsage {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  // OpenAI's prompt_tokens already includes cached reads (matches our convention).
  return { inputTokens: usage?.prompt_tokens ?? 0, cachedInputTokens: cached, outputTokens: usage?.completion_tokens ?? 0 };
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: LlmProviderId;

  constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly factory: OpenAiClientFactory = (apiKey) =>
      new OpenAI({ apiKey, ...(config.baseUrl === undefined ? {} : { baseURL: config.baseUrl }) }) as unknown as OpenAiClientLike,
  ) {
    this.id = config.id;
  }

  capabilities(): LlmProviderCapabilities {
    return { features: ['qa'], vision: true };
  }

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.factory(apiKey).models.list();
    } catch (error) {
      throw new LlmRequestError(`${this.id} key validation failed: ${describe(error)}`, { cause: error });
    }
    signal?.throwIfAborted();
  }

  async qa(call: LlmQaCall, apiKey: string, signal?: AbortSignal): Promise<LlmQaOutcome> {
    const modelId = pricingFor(this.id).featureModel.qa;
    if (modelId === undefined) {
      throw new LlmRequestError(`No ${this.id} Q&A model configured.`);
    }
    const dataUrl = `data:${call.image.mediaType};base64,${call.image.bytes.toString('base64')}`;
    const body: OpenAiChatBody = {
      model: modelId,
      [this.config.tokenParam]: call.maxOutputTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: composePrompt(call.prompt, call.context) },
          ],
        },
      ],
    };
    let response: OpenAiChatResponse;
    try {
      response = await this.factory(apiKey).chat.completions.create(body);
    } catch (error) {
      throw new LlmRequestError(`${this.id} request failed: ${describe(error)}`, { cause: error });
    }
    signal?.throwIfAborted();
    const choice = response.choices[0];
    if (choice === undefined) {
      throw new LlmRequestError(`${this.id} returned no choices.`);
    }
    if (choice.finish_reason === 'content_filter' || (choice.message.refusal ?? null) !== null) {
      throw new LlmRefusalError(`${this.id} declined this request.`);
    }
    const answer = (choice.message.content ?? '').trim();
    // A successful-but-empty answer would show as a blank reply the user was still billed for; fail instead.
    if (answer === '') {
      throw new LlmRequestError(`${this.id} returned an empty answer.`);
    }
    return { answer, modelId, usage: normaliseUsage(response.usage) };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
