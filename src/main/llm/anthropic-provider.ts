import Anthropic from '@anthropic-ai/sdk';

import type { TokenUsage } from '../../shared/llm/cost.js';
import { pricingFor } from '../../shared/llm/pricing.js';
import type { LlmProviderCapabilities } from '../../shared/llm/provider.js';
import { LlmRefusalError, LlmRequestError, type LlmProvider, type LlmQaCall, type LlmQaOutcome } from './provider.js';
import { composePrompt, SYSTEM_PROMPT } from './prompt.js';

// Anthropic reference adapter (ADR-0018 §7): Messages API with vision. Q&A is a
// single-shot vision task, so thinking is disabled — predictable, low, and
// honestly-priced cost per ask rather than an open-ended reasoning bill.

// The slice of the SDK this adapter uses, narrowed so tests can inject a fake
// and so the adapter is not coupled to the SDK's exact param generics.
interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number | null;
}
interface AnthropicMessage {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly stop_reason: string | null;
  readonly usage: AnthropicUsage;
}
interface AnthropicMessageBody {
  readonly model: string;
  readonly max_tokens: number;
  readonly thinking: { readonly type: 'disabled' };
  readonly system: string;
  readonly messages: readonly unknown[];
}
export interface AnthropicClientLike {
  readonly messages: { create(body: AnthropicMessageBody): Promise<AnthropicMessage> };
  readonly models: { list(): Promise<unknown> };
}
export type AnthropicClientFactory = (apiKey: string) => AnthropicClientLike;

const defaultFactory: AnthropicClientFactory = (apiKey) => new Anthropic({ apiKey }) as unknown as AnthropicClientLike;

function normaliseUsage(usage: AnthropicUsage): TokenUsage {
  const cached = usage.cache_read_input_tokens ?? 0;
  // Anthropic's input_tokens is the uncached remainder; total input adds cache reads.
  return { inputTokens: (usage.input_tokens ?? 0) + cached, cachedInputTokens: cached, outputTokens: usage.output_tokens ?? 0 };
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;

  constructor(private readonly factory: AnthropicClientFactory = defaultFactory) {}

  capabilities(): LlmProviderCapabilities {
    return { features: ['qa'], vision: true };
  }

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.factory(apiKey).models.list();
    } catch (error) {
      throw new LlmRequestError(`Anthropic key validation failed: ${describe(error)}`, { cause: error });
    }
    signal?.throwIfAborted();
  }

  async qa(call: LlmQaCall, apiKey: string, signal?: AbortSignal): Promise<LlmQaOutcome> {
    const modelId = pricingFor('anthropic').featureModel.qa;
    if (modelId === undefined) {
      throw new LlmRequestError('No Anthropic Q&A model configured.');
    }
    let message: AnthropicMessage;
    try {
      message = await this.factory(apiKey).messages.create({
        model: modelId,
        max_tokens: call.maxOutputTokens,
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: call.image.mediaType, data: call.image.bytes.toString('base64') },
              },
              { type: 'text', text: composePrompt(call.prompt, call.context) },
            ],
          },
        ],
      });
    } catch (error) {
      throw new LlmRequestError(`Anthropic request failed: ${describe(error)}`, { cause: error });
    }
    signal?.throwIfAborted();
    if (message.stop_reason === 'refusal') {
      throw new LlmRefusalError('Anthropic declined this request.');
    }
    const answer = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();
    return { answer, modelId, usage: normaliseUsage(message.usage) };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
