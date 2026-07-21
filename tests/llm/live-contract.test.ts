import { test } from 'node:test';
import assert from 'node:assert/strict';

import sharp from 'sharp';

import { costUsd, formatUsd } from '../../src/shared/llm/cost.js';
import { modelPriceFor } from '../../src/shared/llm/pricing.js';
import type { LlmProviderId } from '../../src/shared/llm/provider.js';
import { AnthropicProvider } from '../../src/main/llm/anthropic-provider.js';
import { OpenAiCompatibleProvider } from '../../src/main/llm/openai-compatible-provider.js';
import type { LlmProvider, LlmQaCall } from '../../src/main/llm/provider.js';

// The LIVE half of #393's provider verification. Env-gated and NEVER in CI:
// it makes a real, paid API call to each provider whose key is in the
// environment. Run with `npm run test:llm:live` after exporting the keys you
// want to exercise:
//
//   OVERLOOK_LLM_LIVE=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... XAI_API_KEY=... npm run test:llm:live
//
// The key is read from the environment — it is never typed by, or visible to,
// the agent. Each provider is skipped unless its key is present, so you can
// test just the one(s) you have. This also proves the pinned model IDs and the
// pricing manifest against the live APIs: a wrong model id fails the request.

const LIVE = process.env['OVERLOOK_LLM_LIVE'] === '1';

// A recognisable image so the answer is checkable: a solid red frame.
async function redImage(): Promise<Buffer> {
  return sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .webp({ quality: 80 })
    .toBuffer();
}

async function smoke(providerId: LlmProviderId, provider: LlmProvider, apiKey: string): Promise<void> {
  await provider.validateKey(apiKey);
  const call: LlmQaCall = {
    prompt: 'What is the single dominant color filling this image? Answer with just the color name.',
    image: { bytes: await redImage(), mediaType: 'image/webp' },
    context: { takenAt: '2026-01-01', cameraModel: 'test-fixture' },
    maxOutputTokens: 200,
  };
  const outcome = await provider.qa(call, apiKey);

  const price = modelPriceFor(providerId, outcome.modelId);
  const cost = price === null ? null : costUsd(price, outcome.usage);
  console.log(`\n  [${providerId}] model=${outcome.modelId}`);
  console.log(`  usage: in=${outcome.usage.inputTokens} cached=${outcome.usage.cachedInputTokens} out=${outcome.usage.outputTokens}`);
  console.log(`  actual cost: ${cost === null ? 'unknown (model not in manifest)' : formatUsd(cost)}`);
  console.log(`  answer: ${outcome.answer}\n`);

  assert.ok(outcome.answer.length > 0, 'a live answer must be non-empty');
  assert.notEqual(price, null, `manifest must price the model the API actually billed (${outcome.modelId})`);
}

const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY'] ?? '';
const OPENAI_KEY = process.env['OPENAI_API_KEY'] ?? '';
const XAI_KEY = process.env['XAI_API_KEY'] ?? '';

test('LIVE Anthropic photo Q&A', { skip: !LIVE || ANTHROPIC_KEY === '', timeout: 2 * 60_000 }, async () => {
  await smoke('anthropic', new AnthropicProvider(), ANTHROPIC_KEY);
});

test('LIVE OpenAI photo Q&A', { skip: !LIVE || OPENAI_KEY === '', timeout: 2 * 60_000 }, async () => {
  await smoke('openai', new OpenAiCompatibleProvider({ id: 'openai', tokenParam: 'max_completion_tokens' }), OPENAI_KEY);
});

test('LIVE xAI Grok photo Q&A', { skip: !LIVE || XAI_KEY === '', timeout: 2 * 60_000 }, async () => {
  await smoke('xai', new OpenAiCompatibleProvider({ id: 'xai', baseUrl: 'https://api.x.ai/v1', tokenParam: 'max_tokens' }), XAI_KEY);
});
