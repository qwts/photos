import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { LlmAuthStore } from '../../src/main/llm/auth-store.js';
import { LlmFacade } from '../../src/main/llm/facade.js';
import { LlmRequestError, type LlmProvider, type LlmQaOutcome } from '../../src/main/llm/provider.js';
import { LlmProviderRuntime } from '../../src/main/llm/runtime.js';
import type { LlmProviderCapabilities, LlmProviderId } from '../../src/shared/llm/provider.js';

const sealing: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
  decryptString: (encrypted) => encrypted.toString('utf8').slice('sealed:'.length),
};

const custodyUnavailable: SafeStorageLike = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.from('unused'),
  decryptString: () => 'unused',
};

// Records every provider call so a "read path never touches the network" claim
// is assertable: providers() must leave these at zero.
class FakeProvider implements LlmProvider {
  validateCalls = 0;
  qaCalls = 0;
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
  qa(): Promise<LlmQaOutcome> {
    this.qaCalls += 1;
    return Promise.resolve({ answer: 'a cat', modelId: 'fake', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 } });
  }
}

function harness(
  providers: LlmProvider[],
  options: { safeStorage?: SafeStorageLike; selected?: LlmProviderId | null } = {},
): { facade: LlmFacade; store: LlmAuthStore } {
  const store = new LlmAuthStore({
    safeStorage: options.safeStorage ?? sealing,
    authRootDir: mkdtempSync(join(tmpdir(), 'overlook-llm-facade-')),
  });
  const runtime = new LlmProviderRuntime({ authStore: store, providers });
  const facade = new LlmFacade({ runtime, selectedProviderId: () => options.selected ?? null });
  return { facade, store };
}

describe('llm facade — provider custody (ADR-0018 §7)', () => {
  test('providers() reports descriptors + the selected provider without calling out', () => {
    const provider = new FakeProvider('anthropic');
    const { facade } = harness([provider], { selected: 'anthropic' });

    const response = facade.providers();
    assert.equal(response.selectedProviderId, 'anthropic');
    assert.equal(response.providers[0]?.id, 'anthropic');
    assert.equal(response.providers[0]?.available, false);
    // The default read path is silent: no key validation, no Q&A.
    assert.equal(provider.validateCalls, 0);
    assert.equal(provider.qaCalls, 0);
  });

  test('providers() returns a null selection when none is configured', () => {
    const { facade } = harness([new FakeProvider('openai')]);
    assert.equal(facade.providers().selectedProviderId, null);
  });

  test('connect validates then seals a good key and reports ok', async () => {
    const provider = new FakeProvider('anthropic');
    const { facade, store } = harness([provider]);

    const result = await facade.connect('anthropic', 'sk-good');
    assert.deepEqual(result, { ok: true, reason: null });
    assert.equal(provider.validateCalls, 1);
    assert.equal(store.load('anthropic'), 'sk-good');
  });

  test('a rejected key returns ok:false with a recoverable reason and is never persisted', async () => {
    const provider = new FakeProvider('anthropic', false);
    const { facade, store } = harness([provider]);

    const result = await facade.connect('anthropic', 'sk-bad');
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /verify that key/i);
    assert.equal(store.load('anthropic'), null);
  });

  test('an unavailable keychain surfaces as a recoverable custody reason, not a throw', async () => {
    const provider = new FakeProvider('anthropic');
    const { facade, store } = harness([provider], { safeStorage: custodyUnavailable });

    const result = await facade.connect('anthropic', 'sk-good');
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /keychain is unavailable/i);
    assert.equal(store.load('anthropic'), null);
  });

  test('disconnect clears the key and reports ok', async () => {
    const provider = new FakeProvider('anthropic');
    const { facade, store } = harness([provider]);
    await facade.connect('anthropic', 'sk-good');

    const result = facade.disconnect('anthropic');
    assert.deepEqual(result, { ok: true, reason: null });
    assert.equal(store.has('anthropic'), false);
  });
});
