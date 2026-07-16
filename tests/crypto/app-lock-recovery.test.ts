import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { AppLockController } from '../../src/main/crypto/app-lock-controller.js';
import { recoverAppLock } from '../../src/main/crypto/app-lock-recovery.js';
import type { AppLockStatus, ConfigureAppLockInput } from '../../src/main/crypto/app-lock-credentials.js';
import { KeyStore, type SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { sealRecoveryKey } from '../../src/main/crypto/recovery.js';

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain, 'utf8'),
    decryptString: (encrypted) => encrypted.toString('utf8'),
  };
}

class RecoveryCredentials {
  readonly recovered: ConfigureAppLockInput[] = [];

  status(): AppLockStatus {
    return { state: 'recovery-required', reason: 'anchor-missing' };
  }

  configure(_input: ConfigureAppLockInput): Promise<void> {
    return Promise.resolve();
  }

  unlock(_password: string) {
    return Promise.resolve({ ok: false, reason: 'recovery-required' } as const);
  }

  changePassword(_current: string, _next: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  recover(input: ConfigureAppLockInput): Promise<void> {
    this.recovered.push({ ...input, masterKey: Buffer.from(input.masterKey) });
    return Promise.resolve();
  }

  remove(_password: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}

function controllerFor(credentials: RecoveryCredentials): AppLockController {
  return new AppLockController({ credentials, openAuthorized: () => undefined, closeAuthorized: () => undefined });
}

describe('app-lock recovery (#311)', () => {
  test('accepts only a recovery key that authenticates every stored library key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-app-lock-recovery-'));
    const store = KeyStore.open({ safeStorage: fakeSafeStorage(), dataDir });
    store.rotate();
    const masterKey = store.masterKeyBytes();
    const recoveryPath = join(dataDir, 'recovery.ovlk');
    writeFileSync(recoveryPath, sealRecoveryKey(masterKey, 'recovery password'));
    const credentials = new RecoveryCredentials();

    assert.deepEqual(
      await recoverAppLock({
        controller: controllerFor(credentials),
        dataDir,
        libraryId: 'library-a',
        path: recoveryPath,
        recoveryPassword: 'recovery password',
        nextPassword: 'New Strong Password 1!',
      }),
      { recovered: true, reason: null },
    );
    assert.equal(credentials.recovered.length, 1);
    assert.deepEqual(credentials.recovered[0]?.masterKey, masterKey);
  });

  test('rejects a valid recovery file from a different library', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-app-lock-recovery-target-'));
    KeyStore.open({ safeStorage: fakeSafeStorage(), dataDir });
    const otherDir = mkdtempSync(join(tmpdir(), 'overlook-app-lock-recovery-other-'));
    const otherMaster = KeyStore.open({ safeStorage: fakeSafeStorage(), dataDir: otherDir }).masterKeyBytes();
    const recoveryPath = join(dataDir, 'recovery.ovlk');
    writeFileSync(recoveryPath, sealRecoveryKey(otherMaster, 'recovery password'));
    const credentials = new RecoveryCredentials();

    assert.deepEqual(
      await recoverAppLock({
        controller: controllerFor(credentials),
        dataDir,
        libraryId: 'library-a',
        path: recoveryPath,
        recoveryPassword: 'recovery password',
        nextPassword: 'New Strong Password 1!',
      }),
      { recovered: false, reason: 'mismatch' },
    );
    assert.deepEqual(credentials.recovered, []);
  });

  test('reports wrong passwords without changing lock credentials', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-app-lock-recovery-password-'));
    const masterKey = KeyStore.open({ safeStorage: fakeSafeStorage(), dataDir }).masterKeyBytes();
    const recoveryPath = join(dataDir, 'recovery.ovlk');
    writeFileSync(recoveryPath, sealRecoveryKey(masterKey, 'correct password'));
    const credentials = new RecoveryCredentials();

    assert.deepEqual(
      await recoverAppLock({
        controller: controllerFor(credentials),
        dataDir,
        libraryId: 'library-a',
        path: recoveryPath,
        recoveryPassword: 'wrong password',
        nextPassword: 'New Strong Password 1!',
      }),
      { recovered: false, reason: 'wrong-password' },
    );
    assert.deepEqual(credentials.recovered, []);
  });

  test('rejects malformed files before credential recovery', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-app-lock-recovery-invalid-'));
    KeyStore.open({ safeStorage: fakeSafeStorage(), dataDir });
    const recoveryPath = join(dataDir, 'recovery.ovlk');
    writeFileSync(recoveryPath, randomBytes(16));
    const credentials = new RecoveryCredentials();

    assert.deepEqual(
      await recoverAppLock({
        controller: controllerFor(credentials),
        dataDir,
        libraryId: 'library-a',
        path: recoveryPath,
        recoveryPassword: 'recovery password',
        nextPassword: 'New Strong Password 1!',
      }),
      { recovered: false, reason: 'invalid' },
    );
    assert.deepEqual(credentials.recovered, []);
  });
});
