import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PCloudCustodyError, PCloudTokenStore } from '../../src/main/backup/pcloud/token-store.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

// #254: token custody mirrors the keystore's — sealed via (fake) safeStorage,
// atomic writes, corrupt/missing reads degrade to "not connected".

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
    decryptString: (encrypted) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('sealed:')) {
        throw new Error('not sealed');
      }
      return text.slice('sealed:'.length);
    },
  };
}

const RECORD = { accessToken: 'tok-1', apiHost: 'eapi.pcloud.com', connectedAt: '2026-07-13T00:00:00.000Z' } as const;

function world(available = true) {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'overlook-pcloud-auth-')), 'library');
  return { dataDir, store: new PCloudTokenStore({ safeStorage: fakeSafeStorage(available), dataDir }) };
}

describe('pCloud token store (#254)', () => {
  test('EXIT CRITERIA: save → load round-trips; the file on disk is sealed, not plaintext', () => {
    const { store, dataDir } = world();
    store.save(RECORD);
    assert.deepEqual(store.load(), RECORD);
    const raw = readFileSync(join(dataDir, 'pcloud-auth.bin'), 'utf8');
    assert.ok(raw.startsWith('sealed:'), 'record travels through safeStorage');
  });

  test('load: missing file reads as not connected', () => {
    assert.equal(world().store.load(), null);
  });

  test('load: undecryptable or malformed records read as not connected', () => {
    const { store, dataDir } = world();
    store.save(RECORD);
    writeFileSync(join(dataDir, 'pcloud-auth.bin'), 'garbage');
    assert.equal(store.load(), null);

    writeFileSync(join(dataDir, 'pcloud-auth.bin'), 'sealed:{"accessToken":""}');
    assert.equal(store.load(), null, 'schema-invalid record is rejected');
  });

  test('save without OS keychain encryption refuses rather than storing plaintext', () => {
    const { store } = world(false);
    assert.throws(() => store.save(RECORD), PCloudCustodyError);
  });

  test('clear removes the record; clearing twice is fine', () => {
    const { store } = world();
    store.save(RECORD);
    store.clear();
    store.clear();
    assert.equal(store.load(), null);
  });
});
