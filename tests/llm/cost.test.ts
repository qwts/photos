import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { costUsd, estimateCostRange, formatUsd, formatUsdRange } from '../../src/shared/llm/cost.js';
import type { ModelPrice } from '../../src/shared/llm/pricing.js';

// $3 / $0.30 / $15 per 1M — the Sonnet-class shape, easy round numbers.
const PRICE: ModelPrice = {
  modelId: 'test-model',
  inputPerMillion: 3.0,
  cachedInputPerMillion: 0.3,
  outputPerMillion: 15.0,
};

describe('llm cost math', () => {
  test('costUsd bills uncached input, cached input, and output separately', () => {
    // 1M uncached input = $3, 1M output = $15.
    const cost = costUsd(PRICE, { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 });
    assert.equal(cost, 18);
  });

  test('costUsd applies the cache-read discount to the cached subset', () => {
    // 1M input of which 0.5M cached: 0.5M @ $3 + 0.5M @ $0.30 = $1.65; no output.
    const cost = costUsd(PRICE, { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 0 });
    assert.ok(Math.abs(cost - 1.65) < 1e-9);
  });

  test('costUsd never returns negative spend even on a malformed negative usage', () => {
    const cost = costUsd(PRICE, { inputTokens: -1000, cachedInputTokens: -5, outputTokens: -10 });
    assert.equal(cost, 0);
  });

  test('costUsd clamps cached tokens to the input total', () => {
    // Cached reported higher than input must not produce a negative uncached charge.
    const cost = costUsd(PRICE, { inputTokens: 100_000, cachedInputTokens: 500_000, outputTokens: 0 });
    assert.ok(Math.abs(cost - (100_000 * 0.3) / 1_000_000) < 1e-9);
  });

  test('estimateCostRange prices input uncached at both ends and spreads on output', () => {
    // 200k input, reply 64..1024 tokens.
    const range = estimateCostRange(PRICE, { inputTokens: 200_000, minOutputTokens: 64, maxOutputTokens: 1024 });
    const inputCost = (200_000 * 3.0) / 1_000_000; // $0.60
    assert.ok(Math.abs(range.low - (inputCost + (64 * 15.0) / 1_000_000)) < 1e-9);
    assert.ok(Math.abs(range.high - (inputCost + (1024 * 15.0) / 1_000_000)) < 1e-9);
    assert.ok(range.high > range.low, 'unknown reply length widens the range');
  });

  test('formatUsd scales precision to magnitude', () => {
    assert.equal(formatUsd(1.2), '$1.20');
    assert.equal(formatUsd(0.012), '$0.012');
    assert.equal(formatUsd(0.0004), '$0.0004');
    assert.equal(formatUsd(0), '$0.00');
  });

  test('formatUsd shows a floor rather than a misleading $0.00 for tiny positive amounts', () => {
    assert.equal(formatUsd(0.00001), '<$0.0001');
  });

  test('formatUsdRange collapses to one value when the ends round equal', () => {
    assert.equal(formatUsdRange({ low: 0.012, high: 0.012 }), '$0.012');
    assert.equal(formatUsdRange({ low: 0.01, high: 0.02 }), '$0.010–$0.020');
  });
});
