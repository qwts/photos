import { test } from 'node:test';
import assert from 'node:assert/strict';

import sharp from 'sharp';

import { costUsd, estimateCostRange, formatUsd, formatUsdRange } from '../../src/shared/llm/cost.js';
import { featureModelPrice, modelPriceFor } from '../../src/shared/llm/pricing.js';
import type { LlmProviderId } from '../../src/shared/llm/provider.js';
import { AnthropicProvider } from '../../src/main/llm/anthropic-provider.js';
import { OpenAiCompatibleProvider } from '../../src/main/llm/openai-compatible-provider.js';
import type { LlmProvider, LlmQaCall } from '../../src/main/llm/provider.js';

// The LIVE half of #393's provider verification. Env-gated and NEVER in CI:
// it makes a real, paid API call to each provider whose key is in the
// environment. The key is read from the environment — never typed by, or
// visible to, the agent. Each provider is skipped unless its key is present.
//
// Cost is bounded and shown up front. Every run first prints, per provider,
// the exact model it will call and the estimated cost, before any request:
// there is a single call per provider with output hard-capped at
// MAX_OUTPUT_TOKENS. A dry run prints those estimates and stops before
// spending anything (and needs no key):
//
//   OVERLOOK_LLM_LIVE=1 OVERLOOK_LLM_DRYRUN=1 npm run test:llm:live   # free, no call
//   OVERLOOK_LLM_LIVE=1 ANTHROPIC_API_KEY=... npm run test:llm:live   # one real ~1c call
//
// A real run also proves the pinned model IDs and the pricing manifest against
// the live APIs: a wrong model id fails the request; an unpriced model fails
// the assertion.

const LIVE = process.env['OVERLOOK_LLM_LIVE'] === '1';
const DRY = process.env['OVERLOOK_LLM_DRYRUN'] === '1';

// One 512px image plus a one-line prompt is a few hundred input tokens; 2000 is
// a deliberately generous ceiling for the pre-call estimate. Output is capped.
const MAX_OUTPUT_TOKENS = 200;
const EST_INPUT_TOKENS = 2000;

// A recognisable image so the answer is checkable: a solid red frame.
async function redImage(): Promise<Buffer> {
  return sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .webp({ quality: 80 })
    .toBuffer();
}

function announceCost(providerId: LlmProviderId): void {
  const price = featureModelPrice(providerId, 'qa');
  const estimate = estimateCostRange(price, {
    inputTokens: EST_INPUT_TOKENS,
    minOutputTokens: 0,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  console.log(`\n  [${providerId}] model=${price.modelId} · output capped at ${MAX_OUTPUT_TOKENS} tokens`);
  console.log(`  estimated cost for this one call: ${formatUsdRange(estimate)} (assuming ≤${EST_INPUT_TOKENS} input tokens)`);
}

async function smoke(providerId: LlmProviderId, provider: LlmProvider, apiKey: string): Promise<void> {
  announceCost(providerId);
  if (DRY) {
    console.log('  DRY RUN — no request sent, nothing spent.\n');
    return;
  }
  await provider.validateKey(apiKey);
  const call: LlmQaCall = {
    prompt: 'What is the single dominant color filling this image? Answer with just the color name.',
    image: { bytes: await redImage(), mediaType: 'image/webp' },
    context: { takenAt: '2026-01-01', cameraModel: 'test-fixture' },
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
  const outcome = await provider.qa(call, apiKey);

  const price = modelPriceFor(providerId, outcome.modelId);
  const cost = price === null ? null : costUsd(price, outcome.usage);
  console.log(`  usage: in=${outcome.usage.inputTokens} cached=${outcome.usage.cachedInputTokens} out=${outcome.usage.outputTokens}`);
  console.log(`  ACTUAL cost: ${cost === null ? 'unknown (model not in manifest)' : formatUsd(cost)}`);
  console.log(`  answer: ${outcome.answer}\n`);

  assert.ok(outcome.answer.length > 0, 'a live answer must be non-empty');
  assert.notEqual(price, null, `manifest must price the model the API actually billed (${outcome.modelId})`);
}

const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY'] ?? '';
const OPENAI_KEY = process.env['OPENAI_API_KEY'] ?? '';
const XAI_KEY = process.env['XAI_API_KEY'] ?? '';

test('LIVE Anthropic photo Q&A', { skip: !LIVE || (!DRY && ANTHROPIC_KEY === ''), timeout: 2 * 60_000 }, async () => {
  await smoke('anthropic', new AnthropicProvider(), ANTHROPIC_KEY);
});

test('LIVE OpenAI photo Q&A', { skip: !LIVE || (!DRY && OPENAI_KEY === ''), timeout: 2 * 60_000 }, async () => {
  await smoke('openai', new OpenAiCompatibleProvider({ id: 'openai', tokenParam: 'max_completion_tokens' }), OPENAI_KEY);
});

test('LIVE xAI Grok photo Q&A', { skip: !LIVE || (!DRY && XAI_KEY === ''), timeout: 2 * 60_000 }, async () => {
  await smoke('xai', new OpenAiCompatibleProvider({ id: 'xai', baseUrl: 'https://api.x.ai/v1', tokenParam: 'max_tokens' }), XAI_KEY);
});
