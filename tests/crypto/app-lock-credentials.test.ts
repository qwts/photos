import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { AppLockCredentialStore, type CredentialAnchor, type CredentialAnchorStore } from '../../src/main/crypto/app-lock-credentials.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'overlook-app-lock-'));
}

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
    decryptString: (encrypted) => encrypted.toString('utf8').replace(/^sealed:/, ''),
  };
}

class FakeAnchorStore implements CredentialAnchorStore {
  anchor: CredentialAnchor | null = null;

  read(): CredentialAnchor | null {
    return this.anchor;
  }

  write(anchor: CredentialAnchor): void {
    this.anchor = structuredClone(anchor);
  }

  clear(): void {
    this.anchor = null;
  }
}

function world(): {
  dataDir: string;
  masterKey: Buffer;
  anchors: FakeAnchorStore;
  store: AppLockCredentialStore;
} {
  const dataDir = tempDir();
  const masterKey = randomBytes(32);
  const anchors = new FakeAnchorStore();
  writeFileSync(join(dataDir, 'master.key'), fakeSafeStorage().encryptString(masterKey.toString('base64')));
  return {
    dataDir,
    masterKey,
    anchors,
    store: new AppLockCredentialStore({ dataDir, anchorStore: anchors, safeStorage: fakeSafeStorage() }),
  };
}

describe('app-lock credential custody (#311, ADR-0013)', () => {
  test('creation rejects weak credentials in the main process', async () => {
    const { store, masterKey } = world();
    await assert.rejects(store.configure({ libraryId: 'library-a', password: 'password', masterKey }), /too weak/);
  });

  test('configure withholds the master behind password and unlock key slots', async () => {
    const { dataDir, masterKey, store } = world();
    await store.configure({ libraryId: 'library-a', password: 'correct horse battery staple', masterKey });

    const raw = readFileSync(join(dataDir, 'master.key'));
    assert.equal(raw.subarray(0, 4).toString('ascii'), 'OVLK');
    assert.equal(raw.includes(masterKey), false);
    assert.equal(raw.includes(Buffer.from('correct horse battery staple')), false);
    assert.deepEqual(store.status(), { state: 'locked', libraryId: 'library-a' });

    assert.deepEqual(await store.unlock('wrong password'), { ok: false, reason: 'wrong-password' });
    const unlocked = await store.unlock('correct horse battery staple');
    assert.equal(unlocked.ok, true);
    if (unlocked.ok) assert.deepEqual(unlocked.masterKey, masterKey);
  });

  test('record tamper or missing/outdated anchor fails closed before password release', async () => {
    const { dataDir, anchors, store, masterKey } = world();
    await store.configure({ libraryId: 'library-a', password: 'correct horse battery staple', masterKey });
    const path = join(dataDir, 'master.key');
    const raw = readFileSync(path);
    const tampered = Buffer.from(raw);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    writeFileSync(path, tampered);
    assert.deepEqual(store.status(), { state: 'recovery-required', reason: 'invalid-record' });

    writeFileSync(path, raw);
    anchors.clear();
    assert.deepEqual(store.status(), { state: 'recovery-required', reason: 'anchor-missing' });

    anchors.write({ libraryId: 'library-a', generation: 0, recordHash: '0'.repeat(64) });
    assert.deepEqual(store.status(), { state: 'recovery-required', reason: 'anchor-mismatch' });
  });

  test('password change rotates custody and revokes the old password', async () => {
    const { store, masterKey } = world();
    await store.configure({ libraryId: 'library-a', password: 'correct horse battery staple', masterKey });
    const firstAnchor = store.anchor();

    assert.equal(await store.changePassword('correct horse battery staple', 'a different excellent password'), true);
    assert.equal((await store.unlock('correct horse battery staple')).ok, false);
    const unlocked = await store.unlock('a different excellent password');
    assert.equal(unlocked.ok, true);
    if (unlocked.ok) assert.deepEqual(unlocked.masterKey, masterKey);
    assert.equal(store.anchor()?.generation, (firstAnchor?.generation ?? 0) + 1);
  });

  test('recovery establishes new custody and remove restores legacy safeStorage custody', async () => {
    const { dataDir, anchors, store, masterKey } = world();
    await store.configure({ libraryId: 'library-a', password: 'correct horse battery staple', masterKey });

    const replacementPassword = 'replacement password with enough strength';
    await store.recover({ libraryId: 'library-a', password: replacementPassword, masterKey });
    assert.equal((await store.unlock('correct horse battery staple')).ok, false);
    assert.equal((await store.unlock(replacementPassword)).ok, true);

    assert.equal(await store.remove(replacementPassword), true);
    assert.deepEqual(store.status(), { state: 'unconfigured' });
    assert.equal(anchors.anchor, null);
    const restored = Buffer.from(fakeSafeStorage().decryptString(readFileSync(join(dataDir, 'master.key'))), 'base64');
    assert.deepEqual(restored, masterKey);
  });
});
