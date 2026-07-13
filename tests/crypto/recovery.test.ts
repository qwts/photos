import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KeyStore, type SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { RecoveryError, fingerprintOf, installRecoveredMaster, openRecoveryKey, sealRecoveryKey } from '../../src/main/crypto/recovery.js';

// Recovery-key custody (#240, ADR-0008): the sealed file round-trips only
// with the right password, authenticates every byte, and install never
// overwrites a working key it can't vouch for.

function fakeSafeStorage(pad = 0x5f): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ pad)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ pad)).toString('utf8'),
  };
}

describe('recovery file (#240)', () => {
  const master = randomBytes(32);
  const sealed = sealRecoveryKey(master, 'correct horse battery staple');

  test('round-trips with the right password', () => {
    assert.deepEqual(openRecoveryKey(sealed, 'correct horse battery staple'), master);
  });

  test('wrong password fails closed, indistinguishable from tampering', () => {
    assert.throws(
      () => openRecoveryKey(sealed, 'wrong password'),
      (error: unknown) => error instanceof RecoveryError && error.reason === 'wrong-password',
    );
    const tampered = Buffer.from(sealed);
    const target = tampered.length - 1;
    tampered[target] = (tampered[target] ?? 0) ^ 0x01;
    assert.throws(
      () => openRecoveryKey(tampered, 'correct horse battery staple'),
      (error: unknown) => error instanceof RecoveryError && error.reason === 'wrong-password',
    );
  });

  test('non-recovery bytes are rejected as invalid, not as a bad password', () => {
    assert.throws(
      () => openRecoveryKey(Buffer.from('not a key file'), 'x'),
      (error: unknown) => error instanceof RecoveryError && error.reason === 'invalid',
    );
    // A flipped header byte breaks the magic → invalid.
    const badMagic = Buffer.from(sealed);
    badMagic[0] = (badMagic[0] ?? 0) ^ 0xff;
    assert.throws(
      () => openRecoveryKey(badMagic, 'correct horse battery staple'),
      (error: unknown) => error instanceof RecoveryError && error.reason === 'invalid',
    );
  });

  test('every seal is unique (fresh salt + nonce) yet opens to the same key', () => {
    const again = sealRecoveryKey(master, 'correct horse battery staple');
    assert.notDeepEqual(again, sealed);
    assert.deepEqual(openRecoveryKey(again, 'correct horse battery staple'), master);
  });

  test('fingerprint is stable, formatted, and not the key bytes', () => {
    const fp = fingerprintOf(master);
    assert.match(fp, /^[0-9A-F]{4}·[0-9A-F]{4}·[0-9A-F]{4}·[0-9A-F]{4}$/u);
    assert.equal(fingerprintOf(master), fp);
    assert.notEqual(fingerprintOf(randomBytes(32)), fp);
    assert.ok(!master.toString('hex').toUpperCase().includes(fp.replaceAll('·', '')));
  });
});

describe('install semantics (#240)', () => {
  test('an empty dir is refused — restore the library files first (review P2-2)', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'overlook-recovery-')), 'library');
    const master = randomBytes(32);
    const storage = fakeSafeStorage();
    // Installing into a void would wedge the next KeyStore.open ("master
    // exists but no library keys").
    assert.equal(installRecoveredMaster(dir, storage, master), 'no-library');
    assert.ok(!existsSync(join(dir, 'master.key')));
  });

  test('reinstalling the key a store already holds is a no-op', () => {
    const storage = fakeSafeStorage();
    const dir = join(mkdtempSync(join(tmpdir(), 'overlook-recovery-e-')), 'library');
    const store = KeyStore.open({ safeStorage: storage, dataDir: dir });
    assert.equal(installRecoveredMaster(dir, storage, store.masterKeyBytes()), 'already-installed');
  });

  test('restored library dir: the matching key installs over a freshly minted wrong master', () => {
    const storage = fakeSafeStorage();
    // Profile A: a real store mints master + KEY #1.
    const dirA = join(mkdtempSync(join(tmpdir(), 'overlook-recovery-a-')), 'library');
    const storeA = KeyStore.open({ safeStorage: storage, dataDir: dirA });
    const masterA = storeA.masterKeyBytes();
    // Profile B: keys.json copied from A, but a DIFFERENT master.key (what a
    // failed bootstrap on a restored dir leaves behind).
    const dirB = join(mkdtempSync(join(tmpdir(), 'overlook-recovery-b-')), 'library');
    KeyStore.open({ safeStorage: storage, dataDir: dirB });
    copyFileSync(join(dirA, 'keys.json'), join(dirB, 'keys.json'));
    // A's master unwraps A's keys.json rows → install replaces B's master.
    assert.equal(installRecoveredMaster(dirB, storage, masterA), 'installed');
    // And the store now opens with A's custody chain.
    const reopened = KeyStore.open({ safeStorage: storage, dataDir: dirB });
    assert.deepEqual(reopened.masterKeyBytes(), masterA);
  });

  test("a key that can't unwrap the stored rows is refused", () => {
    const storage = fakeSafeStorage();
    const dir = join(mkdtempSync(join(tmpdir(), 'overlook-recovery-c-')), 'library');
    KeyStore.open({ safeStorage: storage, dataDir: dir });
    assert.equal(installRecoveredMaster(dir, storage, randomBytes(32)), 'mismatch');
  });

  test('a differing master with no keys file to arbitrate is refused', () => {
    const storage = fakeSafeStorage();
    const dir = join(mkdtempSync(join(tmpdir(), 'overlook-recovery-d-')), 'library');
    // A store with master.key but a lost keys.json: nothing vouches for a
    // DIFFERENT key — refuse rather than clobber custody.
    KeyStore.open({ safeStorage: storage, dataDir: dir });
    rmSync(join(dir, 'keys.json'));
    assert.equal(installRecoveredMaster(dir, storage, randomBytes(32)), 'mismatch');
  });
});
