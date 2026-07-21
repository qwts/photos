import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { LlmAuthStore } from '../../src/main/llm/auth-store.js';
import { LlmRequestError, type LlmProvider, type LlmQaCall, type LlmQaOutcome } from '../../src/main/llm/provider.js';
import { LlmProviderRuntime } from '../../src/main/llm/runtime.js';
import type { LlmProviderCapabilities, LlmProviderId } from '../../src/shared/llm/provider.js';

const sealing: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
  decryptString: (encrypted) => encrypted.toString('utf8').slice('sealed:'.length),
};

class FakeProvider implements LlmProvider {
  validateCalls = 0;
  qaCalls: { call: LlmQaCall; apiKey: string }[] = [];
  constructor(
    readonly id: LlmProviderId,
    private readonly validateOk = true,
  ) {}
  capabilities(): LlmProviderCapabilities {
    return { features: ['qa'], vision: true };
  }
  validateKey(): Promise<void> {
    this.validateCalls += 1;
    return this.validateOk ? Promise.resolve() : Promise.reject(new LlmRequestError('bad key'));
  }
  qa(call: LlmQaCall, apiKey: string): Promise<LlmQaOutcome> {
    this.qaCalls.push({ call, apiKey });
    return Promise.resolve({
      answer: 'a cat',
      modelId: 'fake-model',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
    });
  }
}

function harness(providers: LlmProvider[]): { runtime: LlmProviderRuntime; store: LlmAuthStore } {
  const store = new LlmAuthStore({ safeStorage: sealing, authRootDir: mkdtempSync(join(tmpdir(), 'overlook-llm-rt-')) });
  return { runtime: new LlmProviderRuntime({ authStore: store, providers }), store };
}

const CALL: LlmQaCall = {
  prompt: 'what is this?',
  image: { bytes: Buffer.from('img'), mediaType: 'image/webp' },
  maxOutputTokens: 512,
};

describe('llm provider runtime (ADR-0018 §7)', () => {
  test('descriptors report availability from key custody', () => {
    const { runtime, store } = harness([new FakeProvider('anthropic')]);
    const before = runtime.descriptors();
    assert.equal(before[0]?.available, false);
    assert.equal(before[0]?.unavailableReason, 'No API key configured.');
    store.save('anthropic', 'sk');
    const after = runtime.descriptors();
    assert.equal(after[0]?.available, true);
    assert.equal(after[0]?.unavailableReason, null);
  });

  test('connect validates the key before sealing it', async () => {
    const provider = new FakeProvider('anthropic');
    const { runtime, store } = harness([provider]);
    await runtime.connect('anthropic', 'sk-good');
    assert.equal(provider.validateCalls, 1);
    assert.equal(store.load('anthropic'), 'sk-good');
  });

  test('a rejected key is never written to custody', async () => {
    const provider = new FakeProvider('anthropic', false);
    const { runtime, store } = harness([provider]);
    await assert.rejects(() => runtime.connect('anthropic', 'sk-bad'), LlmRequestError);
    assert.equal(store.load('anthropic'), null);
  });

  test('qa dispatches with the stored key', async () => {
    const provider = new FakeProvider('anthropic');
    const { runtime, store } = harness([provider]);
    store.save('anthropic', 'sk-stored');
    const outcome = await runtime.qa('anthropic', CALL);
    assert.equal(outcome.answer, 'a cat');
    assert.equal(provider.qaCalls[0]?.apiKey, 'sk-stored');
  });

  test('qa without a key in custody fails rather than calling out', async () => {
    const provider = new FakeProvider('anthropic');
    const { runtime } = harness([provider]);
    await assert.rejects(() => runtime.qa('anthropic', CALL), LlmRequestError);
    assert.equal(provider.qaCalls.length, 0);
  });

  test('disconnect clears the key', () => {
    const { runtime, store } = harness([new FakeProvider('anthropic')]);
    store.save('anthropic', 'sk');
    runtime.disconnect('anthropic');
    assert.equal(store.has('anthropic'), false);
  });
});
