import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  TouchIdAdapterError,
  TouchIdService,
  type TouchIdAvailability,
  type TouchIdSecureAdapter,
} from '../../src/main/crypto/touch-id.js';
import type { CredentialAnchor, MasterReleaseResult, UnlockKeyResult } from '../../src/main/crypto/app-lock-credentials.js';

const U = Buffer.alloc(32, 0x55);
const M = Buffer.alloc(32, 0x4d);

class FakeAdapter implements TouchIdSecureAdapter {
  availabilityState: TouchIdAvailability = { available: true, reason: null };
  readonly items = new Map<string, Buffer>();
  readError: TouchIdAdapterError | null = null;
  storeError = false;
  clearError = false;
  lastReason: string | null = null;
  onAvailability: (() => void) | null = null;

  availability(): TouchIdAvailability {
    this.onAvailability?.();
    return this.availabilityState;
  }

  store(account: string, secret: Buffer): Promise<void> {
    if (this.storeError) return Promise.reject(new TouchIdAdapterError('storage-failure'));
    this.items.set(account, Buffer.from(secret));
    return Promise.resolve();
  }

  read(account: string, reason: string): Promise<Buffer> {
    this.lastReason = reason;
    if (this.readError !== null) return Promise.reject(this.readError);
    const item = this.items.get(account);
    return item === undefined ? Promise.reject(new TouchIdAdapterError('missing')) : Promise.resolve(Buffer.from(item));
  }

  clear(account: string): Promise<void> {
    if (this.clearError) return Promise.reject(new TouchIdAdapterError('storage-failure'));
    this.items.delete(account);
    return Promise.resolve();
  }
}

function anchor(generation = 1): CredentialAnchor {
  return { libraryId: 'library-a', generation, recordHash: String(generation).padStart(64, '0') };
}

function world() {
  const dataDir = mkdtempSync(join(tmpdir(), 'overlook-touch-id-'));
  const adapter = new FakeAdapter();
  let currentAnchor: CredentialAnchor | null = anchor();
  const credentials = {
    anchor: () => currentAnchor,
    releaseUnlockKey: (password: string): Promise<UnlockKeyResult> =>
      Promise.resolve(password === 'correct password' ? { ok: true, unlockKey: Buffer.from(U) } : { ok: false, reason: 'wrong-password' }),
    unlockWithKey: (unlockKey: Buffer): MasterReleaseResult =>
      unlockKey.equals(U) ? { ok: true, masterKey: Buffer.from(M) } : { ok: false, reason: 'invalid-unlock-key' },
  };
  return {
    dataDir,
    adapter,
    service: new TouchIdService(dataDir, adapter, credentials),
    rotate: () => {
      currentAnchor = anchor(2);
    },
    removeCredentials: () => {
      currentAnchor = null;
    },
  };
}

describe('Touch ID unlock-key custody (#310)', () => {
  test('opt-in stores U natively, persists only a non-secret marker, and unlocks M after restart', async () => {
    const w = world();
    assert.deepEqual(await w.service.enable('wrong'), { ok: false, reason: 'wrong-password' });
    assert.deepEqual(await w.service.enable('correct password'), { ok: true });
    assert.deepEqual(await w.service.status(), { available: true, reason: null, enabled: true, reenrollmentRequired: false });

    const marker = readFileSync(join(w.dataDir, 'touch-id.json'));
    assert.equal(marker.includes(U), false);
    assert.equal(marker.includes(M), false);
    assert.equal(marker.includes(Buffer.from('correct password')), false);

    const restarted = new TouchIdService(w.dataDir, w.adapter, {
      anchor: () => anchor(),
      releaseUnlockKey: () => Promise.resolve({ ok: false, reason: 'wrong-password' }),
      unlockWithKey: (key) => (key.equals(U) ? { ok: true, masterKey: Buffer.from(M) } : { ok: false, reason: 'invalid-unlock-key' }),
    });
    const unlocked = await restarted.unlockMaster();
    assert.equal(unlocked.ok, true);
    if (unlocked.ok) assert.deepEqual(unlocked.masterKey, M);
    assert.equal(w.adapter.lastReason, 'Unlock Overlook');
  });

  test('cancel and failed scans preserve enrollment without password throttling semantics', async () => {
    const w = world();
    await w.service.enable('correct password');
    w.adapter.readError = new TouchIdAdapterError('cancelled');
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'cancelled' });
    assert.equal((await w.service.status()).enabled, true);
    w.adapter.readError = new TouchIdAdapterError('failed');
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'failed' });
    assert.equal((await w.service.status()).enabled, true);
    w.adapter.readError = new TouchIdAdapterError('storage-failure');
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'unavailable' });
    w.adapter.readError = new TouchIdAdapterError('locked-out');
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'locked-out' });
    w.adapter.readError = null;
    w.adapter.availabilityState = { available: false, reason: 'locked-out' };
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'locked-out' });
    w.adapter.availabilityState = { available: false, reason: 'unavailable' };
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'unavailable' });
  });

  test('changed enrollment or invalid native U revokes the marker and requires password re-opt-in', async () => {
    const w = world();
    await w.service.enable('correct password');
    w.adapter.readError = new TouchIdAdapterError('missing');
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'enrollment-changed' });
    assert.equal(existsSync(join(w.dataDir, 'touch-id.json')), false);

    w.adapter.readError = null;
    await w.service.enable('correct password');
    const account = [...w.adapter.items.keys()][0];
    assert.notEqual(account, undefined);
    if (account !== undefined) w.adapter.items.set(account, Buffer.alloc(32));
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'enrollment-changed' });
    assert.equal((await w.service.status()).enabled, false);

    await w.service.enable('correct password');
    const recoveryRequired = new TouchIdService(w.dataDir, w.adapter, {
      anchor: () => anchor(),
      releaseUnlockKey: () => Promise.resolve({ ok: false, reason: 'recovery-required' }),
      unlockWithKey: () => ({ ok: false, reason: 'recovery-required' }),
    });
    assert.deepEqual(await recoveryRequired.unlockMaster(), { ok: false, reason: 'recovery-required' });
    assert.equal((await w.service.status()).enabled, false);
  });
});

describe('Touch ID credential lifecycle (#310)', () => {
  test('credential rotation cryptographically invalidates and eagerly clears old enrollment', async () => {
    const w = world();
    await w.service.enable('correct password');
    w.rotate();
    assert.equal((await w.service.status()).enabled, false, 'startup reconciliation revokes a stale anchor');
    await w.service.enable('correct password');
    w.removeCredentials();
    await w.service.credentialsChanged();
    assert.deepEqual(await w.service.status(), { available: true, reason: null, enabled: false, reenrollmentRequired: false });
    assert.equal(w.adapter.items.size, 0);
    assert.deepEqual(await w.service.enable('correct password'), { ok: false, reason: 'recovery-required' });
  });

  test('credential rotation during password verification never enrolls a stale U', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-touch-id-race-'));
    const adapter = new FakeAdapter();
    let currentAnchor: CredentialAnchor | null = anchor();
    let release: ((result: UnlockKeyResult) => void) | undefined;
    const pending = new Promise<UnlockKeyResult>((resolve) => {
      release = resolve;
    });
    const service = new TouchIdService(dataDir, adapter, {
      anchor: () => currentAnchor,
      releaseUnlockKey: () => pending,
      unlockWithKey: () => ({ ok: false, reason: 'invalid-unlock-key' }),
    });

    const enrollment = service.enable('correct password');
    currentAnchor = anchor(2);
    release?.({ ok: true, unlockKey: Buffer.from(U) });
    assert.deepEqual(await enrollment, { ok: false, reason: 'recovery-required' });
    assert.equal(adapter.items.size, 0);
    assert.equal(existsSync(join(dataDir, 'touch-id.json')), false);
  });
});

describe('Touch ID availability and failure handling (#310)', () => {
  test('unsupported and unsigned adapters never pretend opt-in succeeded', async () => {
    const w = world();
    w.adapter.availabilityState = { available: false, reason: 'unsigned-build' };
    assert.deepEqual(await w.service.enable('correct password'), { ok: false, reason: 'unsigned-build' });
    assert.deepEqual(await w.service.status(), {
      available: false,
      reason: 'unsigned-build',
      enabled: false,
      reenrollmentRequired: false,
    });
    assert.equal(w.adapter.items.size, 0);
  });

  test('native storage failure leaves no enrollment marker and explicit opt-out clears custody', async () => {
    const w = world();
    w.adapter.storeError = true;
    w.adapter.clearError = true;
    assert.deepEqual(await w.service.enable('correct password'), { ok: false, reason: 'unavailable' });
    assert.equal(existsSync(join(w.dataDir, 'touch-id.json')), false);
    w.adapter.storeError = false;
    w.adapter.clearError = false;
    await w.service.enable('correct password');
    w.adapter.clearError = true;
    assert.equal(await w.service.disable(), false);
    assert.equal((await w.service.status()).enabled, true);
    w.adapter.clearError = false;
    assert.equal(await w.service.disable(), true);
    assert.equal(await w.service.disable(), true);
    assert.equal(w.adapter.items.size, 0);
    assert.equal((await w.service.status()).enabled, false);
  });

  test('failed re-enrollment revokes the old marker and native custody', async () => {
    const w = world();
    await w.service.enable('correct password');
    w.adapter.storeError = true;

    assert.deepEqual(await w.service.enable('correct password'), { ok: false, reason: 'unavailable' });
    assert.equal(existsSync(join(w.dataDir, 'touch-id.json')), false);
    assert.equal(w.adapter.items.size, 0);
    assert.equal((await w.service.status()).enabled, false);
  });

  test('invalid markers fail closed and a marker removed mid-status cannot unlock', async () => {
    const w = world();
    const markerPath = join(w.dataDir, 'touch-id.json');
    writeFileSync(markerPath, '{"version":999,"account":"secret"}');
    assert.deepEqual(await w.service.status(), { available: true, reason: null, enabled: false, reenrollmentRequired: false });
    assert.equal(existsSync(markerPath), false);

    await w.service.enable('correct password');
    w.adapter.onAvailability = () => {
      unlinkSync(markerPath);
      w.adapter.onAvailability = null;
    };
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'not-enabled' });
  });

  test('legacy identity marker requires password re-enrollment without claiming Touch ID is enabled', async () => {
    const w = world();
    const legacy = anchor();
    const markerPath = join(w.dataDir, 'touch-id.json');
    writeFileSync(
      markerPath,
      JSON.stringify({
        version: 1,
        account: `v1:${legacy.recordHash}`,
        libraryId: legacy.libraryId,
        generation: legacy.generation,
        recordHash: legacy.recordHash,
      }),
    );

    assert.deepEqual(await w.service.status(), {
      available: true,
      reason: null,
      enabled: false,
      reenrollmentRequired: true,
    });
    assert.deepEqual(await w.service.unlockMaster(), { ok: false, reason: 'not-enabled' });
    assert.equal(existsSync(markerPath), true, 'the re-enrollment notice persists until the user acts');

    assert.deepEqual(await w.service.enable('correct password'), { ok: true });
    assert.deepEqual(await w.service.status(), {
      available: true,
      reason: null,
      enabled: true,
      reenrollmentRequired: false,
    });
    const upgradedMarker: unknown = JSON.parse(readFileSync(markerPath, 'utf8'));
    assert.ok(upgradedMarker !== null && typeof upgradedMarker === 'object' && 'bundleId' in upgradedMarker);
    assert.equal(upgradedMarker.bundleId, 'com.zts1.overlook');
  });
});
