import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KeyStore, type SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { RelocationError } from '../../src/main/library/relocation-engine.js';
import { verifyStagedLibrary } from '../../src/main/library/relocation-verify.js';

// PR #553 review / ADR-0022 §4 step 3: the staged custody probe must refuse
// incomplete copies before touching the keychain, accept app-locked (OVLK)
// custody without a password, and genuinely open safeStorage custody.

function fakeSafeStorage(pad: number): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ pad)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ pad)).toString('utf8'),
  };
}

const untouchableKeychain = (): SafeStorageLike => {
  throw new Error('the probe must not touch the keychain here');
};

const rejectsVerification = async (promise: Promise<void>): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof RelocationError);
    assert.equal(error.reason, 'verification-failed');
    return true;
  });
};

describe('staged-library custody probe (#483, ADR-0022 §4)', () => {
  test('missing custody files refuse before any probe — never mint into a bad copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-verify-'));
    await rejectsVerification(verifyStagedLibrary(untouchableKeychain, dir));
  });

  test('app-locked OVLK custody passes without the password and without the keychain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-verify-ovlk-'));
    writeFileSync(join(dir, 'master.key'), Buffer.concat([Buffer.from('OVLK', 'ascii'), Buffer.from([1, 0, 2, 3])]));
    writeFileSync(join(dir, 'keys.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'library.db'), 'sqlcipher-bytes', 'utf8');
    // Teardown zeroed the released master; the digest pass already proved the
    // custody bytes identical — the open probe is skipped, not failed.
    await verifyStagedLibrary(untouchableKeychain, dir);
  });

  test('safeStorage custody opens for real, and a foreign keychain fails verification', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-verify-open-'));
    const storage = fakeSafeStorage(0x5a);
    const keyStore = KeyStore.open({ safeStorage: storage, dataDir: dir });
    try {
      const dbKey = keyStore.resolver()(1);
      assert.ok(dbKey !== undefined);
      const db = openLibraryDatabase({ path: join(dir, 'library.db'), dbKey });
      db.close();
    } finally {
      keyStore.close();
    }

    await verifyStagedLibrary(() => storage, dir);
    // A different fake pad simulates another machine's keychain: the wrapped
    // master no longer unwraps, and the probe reports it as verification.
    await rejectsVerification(verifyStagedLibrary(() => fakeSafeStorage(0x33), dir));
  });
});
