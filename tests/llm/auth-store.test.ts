import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LlmAuthStore, LlmCustodyError } from '../../src/main/llm/auth-store.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

const sealing: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
  decryptString: (encrypted) => encrypted.toString('utf8').slice('sealed:'.length),
};

function storeIn(root: string, safeStorage: SafeStorageLike = sealing): LlmAuthStore {
  return new LlmAuthStore({ safeStorage, authRootDir: root });
}

describe('llm auth store (ADR-0018 §7 key custody)', () => {
  test('save then load round-trips the key through sealed custody', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-llm-auth-'));
    const store = storeIn(root);
    assert.equal(store.has('anthropic'), false);
    store.save('anthropic', 'sk-ant-secret');
    assert.equal(store.has('anthropic'), true);
    assert.equal(store.load('anthropic'), 'sk-ant-secret');
    // Custody lives under llm-auth/<providerId>/, isolated per provider.
    assert.deepEqual(readdirSync(root).sort(), ['anthropic']);
  });

  test('providers are isolated: one key does not leak into another', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-llm-auth-'));
    const store = storeIn(root);
    store.save('openai', 'sk-openai');
    assert.equal(store.load('openai'), 'sk-openai');
    assert.equal(store.load('anthropic'), null);
    assert.equal(store.has('xai'), false);
  });

  test('clear removes the key', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-llm-auth-'));
    const store = storeIn(root);
    store.save('xai', 'xai-key');
    store.clear('xai');
    assert.equal(store.load('xai'), null);
    assert.equal(store.has('xai'), false);
  });

  test('an unreadable record reads as not-connected rather than throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-llm-auth-'));
    const store = storeIn(root);
    store.save('anthropic', 'sk-ant');
    // Simulate a record sealed under a different keychain: decrypt throws.
    const broken: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
      decryptString: () => {
        throw new Error('cannot decrypt');
      },
    };
    assert.equal(storeIn(root, broken).load('anthropic'), null);
  });

  test('garbage on disk reads as not-connected', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-llm-auth-'));
    const store = storeIn(root);
    store.save('anthropic', 'sk-ant');
    writeFileSync(join(root, 'anthropic', 'key.bin'), Buffer.from('sealed:not-json', 'utf8'));
    assert.equal(store.load('anthropic'), null);
  });

  test('saving without OS encryption fails loud rather than writing plaintext', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-llm-auth-'));
    const store = storeIn(root, { ...sealing, isEncryptionAvailable: () => false });
    assert.throws(() => store.save('anthropic', 'sk-ant'), LlmCustodyError);
    assert.equal(existsSync(join(root, 'anthropic')), false);
  });
});
