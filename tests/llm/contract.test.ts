import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  llmAskResponseSchema,
  llmEstimateResponseSchema,
  llmSpendResponseSchema,
  tokenUsageSchema,
} from '../../src/shared/llm/contract.js';

describe('llm ipc contract', () => {
  test('a successful ask response validates', () => {
    const parsed = llmAskResponseSchema.parse({
      ok: true,
      reason: null,
      answer: 'A cat.',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      costUsd: 0.0015,
      usage: { inputTokens: 477, cachedInputTokens: 0, outputTokens: 4 },
    });
    assert.equal(parsed.answer, 'A cat.');
  });

  test('a not-available estimate carries a reason and null figures', () => {
    const parsed = llmEstimateResponseSchema.parse({
      ok: false,
      reason: 'Ask-about-this-photo is off.',
      providerId: null,
      modelId: null,
      lowUsd: null,
      highUsd: null,
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.lowUsd, null);
  });

  test('token usage rejects negative counts', () => {
    assert.throws(() => tokenUsageSchema.parse({ inputTokens: -1, cachedInputTokens: 0, outputTokens: 0 }));
  });

  test('spend totals validate', () => {
    const parsed = llmSpendResponseSchema.parse({
      totals: [{ providerId: 'openai', totalUsd: 0.0123, requests: 3 }],
    });
    assert.equal(parsed.totals[0]?.requests, 3);
  });
});
