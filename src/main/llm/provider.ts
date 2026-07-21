import type { TokenUsage } from '../../shared/llm/cost.js';
import type { LlmProviderCapabilities, LlmProviderId } from '../../shared/llm/provider.js';

// Main-side LLM provider adapter contract (ADR-0018 §7). Concrete adapters
// (Anthropic, OpenAI, xAI) wrap their official SDK and normalise every
// provider's usage report onto the shared `TokenUsage` shape, so cost math is
// provider-agnostic. Adapters are stateless: the runtime resolves the API key
// from custody and passes it per call.

/** The one image that may leave the device (ADR-0018 §7): ≤1024px, EXIF-stripped. */
export interface LlmImage {
  readonly bytes: Buffer;
  readonly mediaType: 'image/webp' | 'image/jpeg' | 'image/png';
}

/** Minimal display context §7 permits: taken-at date and camera model only — never place, GPS, or paths. */
export interface LlmDisplayContext {
  readonly takenAt?: string;
  readonly cameraModel?: string;
}

export interface LlmQaCall {
  readonly prompt: string;
  readonly image: LlmImage;
  readonly context?: LlmDisplayContext;
  /** Hard ceiling on reply length; also the high end of the cost estimate. */
  readonly maxOutputTokens: number;
}

export interface LlmQaOutcome {
  readonly answer: string;
  readonly modelId: string;
  readonly usage: TokenUsage;
}

/** The provider (or its safety classifier) declined the request. Not retryable as-is. */
export class LlmRefusalError extends Error {
  override readonly name = 'LlmRefusalError';
}

/** A key is missing, invalid, or the request otherwise failed. */
export class LlmRequestError extends Error {
  override readonly name = 'LlmRequestError';
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  capabilities(): LlmProviderCapabilities;
  /** Cheap liveness/authorization check for a key at connect time. Throws LlmRequestError on failure. */
  validateKey(apiKey: string, signal?: AbortSignal): Promise<void>;
  /** Answer a question about one photo. Throws LlmRefusalError on a decline, LlmRequestError otherwise. */
  qa(call: LlmQaCall, apiKey: string, signal?: AbortSignal): Promise<LlmQaOutcome>;
}
