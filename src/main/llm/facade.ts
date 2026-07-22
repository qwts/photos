import type { z } from 'zod';

import type { llmProvidersResponseSchema } from '../../shared/llm/contract.js';
import type { LlmProviderId } from '../../shared/llm/provider.js';
import { LlmCustodyError } from './auth-store.js';
import { LlmRequestError } from './provider.js';
import type { LlmProviderRuntime } from './runtime.js';

// The enforcement layer between the LLM IPC handlers and the provider runtime
// (ADR-0018 §7, #393). This slice covers provider custody — list, connect,
// disconnect — which the settings pane drives. The Q&A path (estimate/ask, its
// consent and protected-domain guards, the in-flight indicator, and the spend
// ledger) lands in the follow-up slice. Expected failures — a rejected key, an
// unavailable keychain — come back as `{ ok: false, reason }` so the pane can
// show a recoverable message, rather than throwing into the detail-free IPC
// error envelope. Reasons are curated strings: a provider/SDK error is never
// echoed through, so nothing about the key or provider internals can leak.

type ProvidersResponse = z.output<typeof llmProvidersResponseSchema>;

export interface LlmMutationResult {
  readonly ok: boolean;
  readonly reason: string | null;
}

export interface LlmFacadeOptions {
  readonly runtime: LlmProviderRuntime;
  /** The profile-scoped selected provider (settings `llmProviderId`), or null. */
  readonly selectedProviderId: () => LlmProviderId | null;
}

function mutationFailureReason(error: unknown): string {
  if (error instanceof LlmCustodyError) {
    return "This device's keychain is unavailable, so the key can't be stored securely.";
  }
  if (error instanceof LlmRequestError) {
    return "Couldn't verify that key with the provider. Check the key and try again.";
  }
  return 'Something went wrong. Please try again.';
}

export class LlmFacade {
  private readonly runtime: LlmProviderRuntime;
  private readonly selectedProviderId: () => LlmProviderId | null;

  constructor(options: LlmFacadeOptions) {
    this.runtime = options.runtime;
    this.selectedProviderId = options.selectedProviderId;
  }

  /** Descriptors + the selected provider. A pure read — never calls a provider. */
  providers(): ProvidersResponse {
    return { providers: this.runtime.descriptors(), selectedProviderId: this.selectedProviderId() };
  }

  /** Validate the key with the provider, then seal it. A bad key returns `ok: false`, never persisted. */
  async connect(providerId: LlmProviderId, apiKey: string): Promise<LlmMutationResult> {
    try {
      await this.runtime.connect(providerId, apiKey);
      return { ok: true, reason: null };
    } catch (error) {
      return { ok: false, reason: mutationFailureReason(error) };
    }
  }

  /** Remove a provider's key from custody. */
  disconnect(providerId: LlmProviderId): LlmMutationResult {
    try {
      this.runtime.disconnect(providerId);
      return { ok: true, reason: null };
    } catch (error) {
      return { ok: false, reason: mutationFailureReason(error) };
    }
  }
}
