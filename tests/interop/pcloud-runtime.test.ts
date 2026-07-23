import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PCloudTokenStore, type PCloudAuthRecord } from '../../src/main/backup/pcloud/token-store.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { createInteropPairingBundle } from '../../src/main/interop/pairing.js';
import { InteropPairingBundleStore, InteropPairingCustodian } from '../../src/main/interop/pairing-custody.js';
import { InteropPCloudRuntime } from '../../src/main/interop/pcloud-runtime.js';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

const BACKUP_AUTH: PCloudAuthRecord = {
  accessToken: 'backup-token',
  apiHost: 'api.pcloud.com',
  connectedAt: '2026-07-21T10:00:00.000Z',
};
const INTEROP_AUTH: PCloudAuthRecord = {
  accessToken: 'interop-token',
  apiHost: 'eapi.pcloud.com',
  connectedAt: '2026-07-21T11:00:00.000Z',
};

test('interop pCloud authorization cannot read, replace, or disconnect backup custody', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'overlook-interop-pcloud-'));
  const backup = new PCloudTokenStore({ safeStorage, dataDir: join(directory, 'provider-auth', 'pcloud') });
  backup.save(BACKUP_AUTH);
  const pairing = new InteropPairingCustodian(new InteropPairingBundleStore(directory));
  pairing.replace(await createInteropPairingBundle('password'));
  await pairing.unlock(Buffer.from('password'));
  const runtime = new InteropPCloudRuntime({
    profileDirectory: directory,
    safeStorage,
    clientId: 'public-test-client',
    openExternal: () => Promise.resolve(),
    pairing,
    connectFlow: (store) => {
      store.save(INTEROP_AUTH);
      return Promise.resolve({ ok: true, reason: null });
    },
  });

  assert.equal((await runtime.state()).status, 'not-connected');
  assert.deepEqual(await runtime.connect(), { ok: true, reason: null });
  assert.equal((await runtime.state()).status, 'connected');
  assert.deepEqual(backup.load(), BACKUP_AUTH, 'interop connection did not replace backup custody');
  assert.deepEqual(runtime.disconnect(), { ok: true, reason: null });
  assert.deepEqual(backup.load(), BACKUP_AUTH, 'interop disconnect did not clear backup custody');
  assert.equal(pairing.state().status, 'locked', 'provider disconnect locked pairing custody');
});

test('active work blocks provider mutation without disrupting unlocked custody', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'overlook-interop-pcloud-active-'));
  const pairing = new InteropPairingCustodian(new InteropPairingBundleStore(directory));
  pairing.replace(await createInteropPairingBundle('password'));
  await pairing.unlock(Buffer.from('password'));
  const runtime = new InteropPCloudRuntime({
    profileDirectory: directory,
    safeStorage,
    clientId: 'public-test-client',
    openExternal: () => Promise.resolve(),
    pairing,
    isWorkActive: () => true,
  });
  assert.equal((await runtime.connect()).ok, false);
  assert.equal(runtime.disconnect().ok, false);
  assert.equal(pairing.state().status, 'unlocked');
});

test('an in-flight sign-in blocks disconnect and reports busy custody', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'overlook-interop-pcloud-connect-'));
  const pairing = new InteropPairingCustodian(new InteropPairingBundleStore(directory));
  let finishConnect: ((result: { ok: boolean; reason: string | null }) => void) | undefined;
  const runtime = new InteropPCloudRuntime({
    profileDirectory: directory,
    safeStorage,
    clientId: 'public-test-client',
    openExternal: () => Promise.resolve(),
    pairing,
    connectFlow: () =>
      new Promise((resolve) => {
        finishConnect = resolve;
      }),
  });
  const connecting = runtime.connect();
  assert.equal((await runtime.state()).busy, true);
  assert.equal(runtime.disconnect().ok, false);
  finishConnect?.({ ok: false, reason: 'cancelled' });
  assert.deepEqual(await connecting, { ok: false, reason: 'cancelled' });
  assert.equal((await runtime.state()).busy, false);
});
