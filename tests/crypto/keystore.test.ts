import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { createDecryptStream, createEncryptStream } from '../../src/main/crypto/envelope.js';
import { KeyCustodyError, KeyStore, type SafeStorageLike } from '../../src/main/crypto/keystore.js';

// Deterministic fake keychain: XORs with a fixed pad so "wrapped" bytes are
// not the plaintext, and a second fake with a different pad simulates a
// different OS account (unwrap must fail loudly).
function fakeSafeStorage(pad: number, available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ pad)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ pad)).toString('utf8'),
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'overlook-keystore-'));
}

describe('KeyStore lifecycle', () => {
  test('first run creates a master key and KEY #1', () => {
    const dataDir = tempDir();
    const store = KeyStore.open({ safeStorage: fakeSafeStorage(0x5a), dataDir });
    assert.equal(store.currentKey().id, 1);
    assert.equal(store.currentKey().key.length, 32);
    assert.deepEqual(
      store.listKeys().map((key) => ({ id: key.id, status: key.status })),
      [{ id: 1, status: 'active' }],
    );
  });

  test('restart persistence: a fresh open on the same dir yields the same keys', () => {
    const dataDir = tempDir();
    const safeStorage = fakeSafeStorage(0x5a);
    const first = KeyStore.open({ safeStorage, dataDir });
    const keyBefore = first.currentKey();

    const reopened = KeyStore.open({ safeStorage, dataDir });
    const keyAfter = reopened.currentKey();
    assert.equal(keyAfter.id, keyBefore.id);
    assert.deepEqual(keyAfter.key, keyBefore.key);
  });

  test('master key on disk is never plaintext', () => {
    const dataDir = tempDir();
    const store = KeyStore.open({ safeStorage: fakeSafeStorage(0x5a), dataDir });
    const onDisk = readFileSync(join(dataDir, 'master.key'));
    assert.ok(!onDisk.includes(store.currentKey().key.toString('base64').slice(0, 8)));
  });

  test('rotation produces KEY #2 as the write key; old-key decrypts still pass', async () => {
    const dataDir = tempDir();
    const store = KeyStore.open({ safeStorage: fakeSafeStorage(0x5a), dataDir });
    const plaintext = randomBytes(4096);
    const context = { photoId: 'photo-1' };
    const envelope = await buffer(Readable.from([plaintext]).pipe(createEncryptStream(store.currentKey(), context, { chunkSize: 1024 })));

    const rotated = store.rotate();
    assert.equal(rotated.id, 2);
    assert.equal(store.currentKey().id, 2);
    assert.deepEqual(
      store.listKeys().map((key) => ({ id: key.id, status: key.status })),
      [
        { id: 1, status: 'retired' },
        { id: 2, status: 'active' },
      ],
    );

    // KEY #1 envelope still decrypts through the resolver.
    const roundTripped = await buffer(Readable.from([envelope]).pipe(createDecryptStream(store.resolver(), context)));
    assert.deepEqual(roundTripped, plaintext);
  });

  test('rotation survives restart', () => {
    const dataDir = tempDir();
    const safeStorage = fakeSafeStorage(0x11);
    const store = KeyStore.open({ safeStorage, dataDir });
    store.rotate();
    store.rotate();
    const reopened = KeyStore.open({ safeStorage, dataDir });
    assert.equal(reopened.currentKey().id, 3);
    assert.equal(reopened.listKeys().length, 3);
    assert.ok(reopened.resolver()(1) !== undefined, 'retired key 1 still resolvable');
  });

  test('createdAt uses the injected clock', () => {
    const dataDir = tempDir();
    const store = KeyStore.open({
      safeStorage: fakeSafeStorage(0x5a),
      dataDir,
      now: () => new Date('2026-07-12T00:00:00.000Z'),
    });
    assert.equal(store.listKeys()[0]?.createdAt, '2026-07-12T00:00:00.000Z');
  });
});

describe('KeyStore failure paths', () => {
  test('keychain unavailable throws a custody error — no plaintext fallback', () => {
    assert.throws(
      () => KeyStore.open({ safeStorage: fakeSafeStorage(0x5a, false), dataDir: tempDir() }),
      (error: unknown) => {
        assert.ok(error instanceof KeyCustodyError);
        assert.match(error.message, /no plaintext fallback/);
        return true;
      },
    );
  });

  test('a different OS keychain identity cannot unwrap the master key', () => {
    const dataDir = tempDir();
    KeyStore.open({ safeStorage: fakeSafeStorage(0x5a), dataDir });
    assert.throws(() => KeyStore.open({ safeStorage: fakeSafeStorage(0x77), dataDir }), /master key (could not be unwrapped|is malformed)/);
  });

  test('a tampered keys.json fails key authentication loudly', () => {
    const dataDir = tempDir();
    const safeStorage = fakeSafeStorage(0x5a);
    KeyStore.open({ safeStorage, dataDir });
    const keysPath = join(dataDir, 'keys.json');
    const file = JSON.parse(readFileSync(keysPath, 'utf8')) as {
      keys: { wrappedKey: string }[];
    };
    const wrapped = Buffer.from(file.keys[0]?.wrappedKey ?? '', 'base64');
    wrapped[wrapped.length - 1] = (wrapped[wrapped.length - 1] ?? 0) ^ 0xff;
    file.keys[0] = { ...file.keys[0], wrappedKey: wrapped.toString('base64') };
    writeFileSync(keysPath, JSON.stringify(file));
    assert.throws(() => KeyStore.open({ safeStorage, dataDir }), /failed authentication/);
  });

  test('a truncated wrapped key is reported as malformed', () => {
    const dataDir = tempDir();
    const safeStorage = fakeSafeStorage(0x5a);
    KeyStore.open({ safeStorage, dataDir });
    const keysPath = join(dataDir, 'keys.json');
    const file = JSON.parse(readFileSync(keysPath, 'utf8')) as { keys: { wrappedKey: string }[] };
    file.keys[0] = { ...file.keys[0], wrappedKey: Buffer.alloc(8).toString('base64') };
    writeFileSync(keysPath, JSON.stringify(file));
    assert.throws(() => KeyStore.open({ safeStorage, dataDir }), /is malformed/);
  });
});
