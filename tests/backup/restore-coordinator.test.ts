import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';

import { buildBackupManifestV2 } from '../../src/main/backup/backup-manifest.js';
import { MockProvider } from '../../src/main/backup/mock-provider.js';
import { sealRecoveryBootstrap } from '../../src/main/backup/recovery-bootstrap.js';
import { RestoreCoordinator, type RestoreRunner } from '../../src/main/backup/restore-coordinator.js';
import { createEncryptStream } from '../../src/main/crypto/envelope.js';
import { KeyStore, type SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { sealRecoveryKey } from '../../src/main/crypto/recovery.js';

const LIBRARY_ID = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
const GENERATED_AT = '2026-07-15T01:00:00.000Z';
const PASSWORD = 'correct horse battery staple';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

async function put(provider: MockProvider, path: string, bytes: Buffer): Promise<void> {
  await provider.put(path, Readable.from([bytes]));
}

async function remoteWorld(libraryId = LIBRARY_ID) {
  const sourceDir = mkdtempSync(join(tmpdir(), 'restore-coordinator-source-'));
  const keys = KeyStore.open({ safeStorage, dataDir: sourceDir });
  const masterKey = keys.masterKeyBytes();
  const provider = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'restore-coordinator-remote-')), libraryId });
  await put(
    provider,
    'recovery/bootstrap.ovrb',
    sealRecoveryBootstrap({ schema: 1, libraryId, generatedAt: GENERATED_AT, keys: keys.exportWrappedKeys() }, masterKey),
  );
  const manifest = buildBackupManifestV2({
    libraryId,
    generatedAt: GENERATED_AT,
    snapshot: {
      databaseSchema: 3,
      keyIds: [1],
      totals: { photos: 0, bytes: 0, albums: 0 },
      photos: [],
      albums: [],
    },
  });
  const sealed = await buffer(
    Readable.from([Buffer.from(JSON.stringify(manifest))]).pipe(createEncryptStream(keys.currentKey(), { photoId: 'manifest' })),
  );
  await put(provider, 'manifest/gen-2.ovlk', sealed);
  return { provider, masterKey, recoveryFile: sealRecoveryKey(masterKey, PASSWORD) };
}

test('restore coordinator discovers validated metadata and runs through an opaque session (#290)', async () => {
  const world = await remoteWorld();
  const progress = [];
  let activated = false;
  const runner: RestoreRunner = {
    run: ({ signal }) => {
      assert.equal(signal?.aborted, false);
      return Promise.resolve({ libraryId: LIBRARY_ID, generation: 2, photos: 0, resumed: false });
    },
  };
  const coordinator = new RestoreCoordinator({
    readRecoveryKey: () => Promise.resolve(world.recoveryFile),
    sources: () => Promise.resolve([{ libraryId: LIBRARY_ID, provider: world.provider }]),
    createRunner: (_provider, emit) => {
      emit({ stage: 'discovering', done: 0, total: 0, photoId: null });
      return runner;
    },
    sessionId: () => 'session-1',
    resumeAvailable: () => Promise.resolve(true),
    progress: (value) => progress.push(value),
    activated: () => {
      activated = true;
    },
  });

  const discovered = await coordinator.discover('mock', '/recovery.key', PASSWORD);
  assert.equal(discovered.sessionId, 'session-1');
  assert.deepEqual(discovered.libraries, [
    {
      libraryId: LIBRARY_ID,
      generation: 2,
      generatedAt: GENERATED_AT,
      photos: 0,
      totalBytes: 0,
      albums: 0,
      compatibility: 'compatible',
      validation: 'valid',
      fallbackGenerations: 0,
      resumable: true,
    },
  ]);
  const run = await coordinator.run('session-1', LIBRARY_ID, false);
  assert.equal(run.error, null);
  assert.equal(run.result?.relaunching, true);
  assert.equal(activated, true);
  assert.equal(progress.length, 1);
  assert.equal((await coordinator.run('session-1', LIBRARY_ID, false)).error?.message.includes('expired'), true);
});

test('wrong recovery password fails before provider discovery', async () => {
  const world = await remoteWorld();
  let sourceCalls = 0;
  const coordinator = new RestoreCoordinator({
    readRecoveryKey: () => Promise.resolve(world.recoveryFile),
    sources: () => {
      sourceCalls += 1;
      return Promise.resolve([]);
    },
    createRunner: () => ({ run: () => Promise.reject(new Error('unused')) }),
    sessionId: () => 'unused',
    progress: () => undefined,
  });
  const result = await coordinator.discover('mock', '/recovery.key', 'wrong password');
  assert.equal(result.error?.reason, 'wrong-key');
  assert.equal(sourceCalls, 0);
});

test('cancelled runs preserve the discovery session for resumable retry', async () => {
  const world = await remoteWorld();
  let attempt = 0;
  const coordinator = new RestoreCoordinator({
    readRecoveryKey: () => Promise.resolve(world.recoveryFile),
    sources: () => Promise.resolve([{ libraryId: LIBRARY_ID, provider: world.provider }]),
    createRunner: () => ({
      run: async ({ signal }) => {
        attempt += 1;
        if (attempt > 1) return { libraryId: LIBRARY_ID, generation: 2, photos: 0, resumed: true };
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
        throw new Error('unreachable');
      },
    }),
    sessionId: () => 'session-resume',
    progress: () => undefined,
  });
  await coordinator.discover('mock', '/recovery.key', PASSWORD);
  const first = coordinator.run('session-resume', LIBRARY_ID, false);
  coordinator.cancel();
  assert.equal((await first).error?.reason, 'cancelled');
  assert.equal((await coordinator.run('session-resume', LIBRARY_ID, false)).result?.resumed, true);
});
