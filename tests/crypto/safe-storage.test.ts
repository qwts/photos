import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pickSafeStorageImpl } from '../../src/main/crypto/safe-storage.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

const real: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain, 'utf8'),
  decryptString: (encrypted) => encrypted.toString('utf8'),
};

describe('safeStorage selection', () => {
  test('packaged builds get the real keychain even with the env var set (ADR-0004)', () => {
    process.env['OVERLOOK_INSECURE_KEYSTORE'] = '1';
    try {
      assert.equal(pickSafeStorageImpl(real, true), real);
    } finally {
      delete process.env['OVERLOOK_INSECURE_KEYSTORE'];
    }
  });

  test('unpackaged without the env var: real keychain', () => {
    assert.equal(pickSafeStorageImpl(real, false), real);
  });

  test('unpackaged with the env var: the obfuscation-only keystore round-trips', () => {
    process.env['OVERLOOK_INSECURE_KEYSTORE'] = '1';
    try {
      const picked = pickSafeStorageImpl(real, false);
      assert.notEqual(picked, real);
      assert.equal(picked.isEncryptionAvailable(), true);
      assert.equal(picked.decryptString(picked.encryptString('sealed-value')), 'sealed-value');
    } finally {
      delete process.env['OVERLOOK_INSECURE_KEYSTORE'];
    }
  });
});
