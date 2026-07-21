import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { llmProviderIdSchema } from '../../src/shared/llm/provider.js';
import { allProviderPricing, featureModelPrice, modelPriceFor, pricingFor } from '../../src/shared/llm/pricing.js';

// The pricing manifest is the auditable source of truth for cost hinting
// (ADR-0018 §7). These guard the two ways it can silently rot: a malformed
// block, or a featureModel pointer with no matching model row.

describe('llm pricing manifest', () => {
  test('every provider block validates and carries a dated source', () => {
    const all = allProviderPricing();
    for (const providerId of llmProviderIdSchema.options) {
      const block = all[providerId];
      assert.equal(block.providerId, providerId);
      assert.match(block.source, /^https:\/\//u, 'source is an auditable URL');
      assert.match(block.asOf, /^\d{4}-\d{2}-\d{2}$/u, 'capture date recorded');
      assert.ok(block.models.length >= 1);
    }
  });

  test('every featureModel pointer resolves to a real model row', () => {
    for (const providerId of llmProviderIdSchema.options) {
      const block = pricingFor(providerId);
      for (const [feature, modelId] of Object.entries(block.featureModel)) {
        assert.notEqual(modelPriceFor(providerId, modelId), null, `${providerId}/${feature} -> ${modelId}`);
      }
    }
  });

  test('cached input never costs more than uncached input', () => {
    for (const providerId of llmProviderIdSchema.options) {
      for (const model of pricingFor(providerId).models) {
        assert.ok(model.cachedInputPerMillion <= model.inputPerMillion, `${providerId}/${model.modelId}: cache read must be a discount`);
      }
    }
  });

  test('featureModelPrice returns the balanced model for qa', () => {
    const price = featureModelPrice('anthropic', 'qa');
    assert.equal(price.modelId, 'claude-sonnet-5');
  });

  test('modelPriceFor is null for an unknown model', () => {
    assert.equal(modelPriceFor('anthropic', 'no-such-model'), null);
  });
});
