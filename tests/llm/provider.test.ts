import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LLM_PROVIDER_LABELS, llmProviderDescriptorSchema, llmProviderIdSchema } from '../../src/shared/llm/provider.js';

describe('llm provider contract', () => {
  test('a not-configured provider is expressed via available + unavailableReason', () => {
    const descriptor = llmProviderDescriptorSchema.parse({
      id: 'anthropic',
      label: 'Anthropic',
      capabilities: { features: ['qa'], vision: true },
      available: false,
      unavailableReason: 'No API key configured.',
    });
    assert.equal(descriptor.available, false);
    assert.equal(descriptor.unavailableReason, 'No API key configured.');
  });

  test('every provider id has a display label', () => {
    for (const id of llmProviderIdSchema.options) {
      assert.equal(typeof LLM_PROVIDER_LABELS[id], 'string');
      assert.ok(LLM_PROVIDER_LABELS[id].length > 0);
    }
  });

  test('an unknown feature is rejected by the capabilities schema', () => {
    assert.throws(() =>
      llmProviderDescriptorSchema.parse({
        id: 'openai',
        label: 'OpenAI',
        capabilities: { features: ['summarize'], vision: true },
        available: true,
        unavailableReason: null,
      }),
    );
  });
});
