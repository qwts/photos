import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RestoreRuntime } from '../../src/main/backup/restore-runtime.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

// #741: the runtime wires the coordinator's key sources — including the
// local-master path — without touching Electron, so the composition is
// coverable under node:test.

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

function runtime(localMasterKey: (() => Buffer | null) | undefined): RestoreRuntime {
  return new RestoreRuntime({
    targetDir: mkdtempSync(join(tmpdir(), 'overlook-restore-runtime-')),
    workerUrl: new URL('file:///unused-thumbnail-worker.js'),
    safeStorage: () => fakeSafeStorage,
    localMasterKey,
    sources: () => Promise.resolve([]),
    sessionId: () => 'session-runtime',
    progress: () => undefined,
    beforeActivate: () => Promise.resolve(),
    workStarted: () => undefined,
    workFinished: () => undefined,
    activated: () => undefined,
  });
}

test('an absent local master key surfaces recovery-key guidance through the runtime (#741)', async () => {
  const r = runtime(() => null);
  const discovery = await r.coordinator.discoverFrom('pcloud', { kind: 'local-master' });
  assert.equal(discovery.sessionId, null);
  assert.equal(discovery.error?.reason, 'wrong-key');
  r.dispose();
  await r.close();
});

test('an unreadable recovery-key file fails discovery without a session', async () => {
  const r = runtime(undefined);
  const missingKey = join(mkdtempSync(join(tmpdir(), 'overlook-restore-key-')), 'absent.ovrk');
  const discovery = await r.coordinator.discover('pcloud', missingKey, 'password');
  assert.equal(discovery.sessionId, null);
  assert.notEqual(discovery.error, null);
  r.dispose();
  await r.close();
});
