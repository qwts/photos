import { LLM_PROVIDER_LABELS, type LlmProviderDescriptor, type LlmProviderId } from '../../shared/llm/provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import type { LlmAuthStore } from './auth-store.js';
import { OpenAiCompatibleProvider } from './openai-compatible-provider.js';
import { LlmRequestError, type LlmProvider, type LlmQaCall, type LlmQaOutcome } from './provider.js';

// LLM provider runtime (ADR-0018 §7), mirroring the storage ProviderRuntime
// (ADR-0011): a registry of adapters plus per-provider key custody. It reports
// descriptors (available = a key is in custody), connects/disconnects keys, and
// dispatches Q&A. Per-feature enablement and provider selection live in
// settings and are enforced a layer up (the facade); the runtime only needs
// the key.

const XAI_BASE_URL = 'https://api.x.ai/v1';

export function defaultLlmProviders(): readonly LlmProvider[] {
  return [
    new AnthropicProvider(),
    new OpenAiCompatibleProvider({ id: 'openai', tokenParam: 'max_completion_tokens' }),
    new OpenAiCompatibleProvider({ id: 'xai', baseUrl: XAI_BASE_URL, tokenParam: 'max_tokens' }),
  ];
}

export interface LlmProviderRuntimeOptions {
  readonly authStore: LlmAuthStore;
  /** Injectable for tests; defaults to the three cloud adapters. */
  readonly providers?: readonly LlmProvider[];
}

export class LlmProviderRuntime {
  private readonly registry = new Map<LlmProviderId, LlmProvider>();
  private readonly authStore: LlmAuthStore;

  constructor(options: LlmProviderRuntimeOptions) {
    this.authStore = options.authStore;
    for (const provider of options.providers ?? defaultLlmProviders()) {
      this.registry.set(provider.id, provider);
    }
  }

  /** One descriptor per registered provider; `available` reflects key custody. */
  descriptors(): readonly LlmProviderDescriptor[] {
    return [...this.registry.values()].map((provider) => {
      const available = this.authStore.has(provider.id);
      return {
        id: provider.id,
        label: LLM_PROVIDER_LABELS[provider.id],
        capabilities: provider.capabilities(),
        available,
        unavailableReason: available ? null : 'No API key configured.',
      };
    });
  }

  private require(providerId: LlmProviderId): LlmProvider {
    const provider = this.registry.get(providerId);
    if (provider === undefined) {
      throw new LlmRequestError(`Unknown LLM provider: ${providerId}`);
    }
    return provider;
  }

  /** Validate a key with the provider, then seal it into custody. Throws on an invalid key. */
  async connect(providerId: LlmProviderId, apiKey: string, signal?: AbortSignal): Promise<void> {
    await this.require(providerId).validateKey(apiKey, signal);
    this.authStore.save(providerId, apiKey);
  }

  /** Remove a provider's key from custody. */
  disconnect(providerId: LlmProviderId): void {
    this.authStore.clear(providerId);
  }

  /** Answer a question about one photo using the provider's stored key. */
  async qa(providerId: LlmProviderId, call: LlmQaCall, signal?: AbortSignal): Promise<LlmQaOutcome> {
    const provider = this.require(providerId);
    const apiKey = this.authStore.load(providerId);
    if (apiKey === null) {
      throw new LlmRequestError(`No API key in custody for ${providerId}.`);
    }
    return provider.qa(call, apiKey, signal);
  }
}
