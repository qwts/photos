import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireLibraryLock, LibraryLockError, lockPath, type LibraryLockRecord } from '../../src/main/library/library-lock.js';

// ADR-0017 §5 / #385: advisory per-library single-instance lock — O_EXCL
// acquire, same-host dead-pid reclaim, cross-host refusal, idempotent release.

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'overlook-lock-'));
}

describe('library lock (#385)', () => {
  test('acquire writes the record and release removes it', () => {
    const dir = tempDir();
    const release = acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 100, isPidAlive: () => true });

    const record = JSON.parse(readFileSync(lockPath(dir), 'utf8')) as LibraryLockRecord;
    assert.equal(record.instanceId, 'instance-a');
    assert.equal(record.pid, 100);
    assert.equal(record.hostname, 'mac-a');

    release();
    assert.ok(!existsSync(lockPath(dir)), 'released lock is gone');
    release();
    assert.ok(!existsSync(lockPath(dir)), 'release is idempotent');
  });

  test('ACCEPTANCE: a second instance targeting an open library is refused with a clear error', () => {
    const dir = tempDir();
    acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 100, isPidAlive: () => true });

    assert.throws(
      () => acquireLibraryLock(dir, 'instance-b', { host: 'mac-a', pid: 200, isPidAlive: () => true }),
      (error: unknown) => error instanceof LibraryLockError && error.reason === 'held-by-instance' && /already open/.test(error.message),
    );
  });

  test('a same-host lock with a dead pid is stale and reclaimed (crash recovery)', () => {
    const dir = tempDir();
    acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 100, isPidAlive: () => true });

    const release = acquireLibraryLock(dir, 'instance-b', { host: 'mac-a', pid: 200, isPidAlive: (pid) => pid !== 100 });
    const record = JSON.parse(readFileSync(lockPath(dir), 'utf8')) as LibraryLockRecord;
    assert.equal(record.instanceId, 'instance-b', 'stale lock reclaimed by the new instance');
    release();
  });

  test('a lock from another host refuses — liveness cannot be verified across machines', () => {
    const dir = tempDir();
    acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 100, isPidAlive: () => true });

    assert.throws(
      () => acquireLibraryLock(dir, 'instance-b', { host: 'mac-b', pid: 100, isPidAlive: () => false }),
      (error: unknown) => error instanceof LibraryLockError && error.reason === 'held-by-other-host' && /mac-a/.test(error.message),
    );
  });

  test('a torn/garbage lock file never wedges the library', () => {
    const dir = tempDir();
    writeFileSync(lockPath(dir), '{ half-written', 'utf8');

    const release = acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 100, isPidAlive: () => true });
    assert.equal((JSON.parse(readFileSync(lockPath(dir), 'utf8')) as LibraryLockRecord).instanceId, 'instance-a');
    release();
  });

  test('release does not remove a lock re-acquired by someone else', () => {
    const dir = tempDir();
    const releaseA = acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 100, isPidAlive: () => true });
    releaseA();
    acquireLibraryLock(dir, 'instance-b', { host: 'mac-a', pid: 200, isPidAlive: () => true });

    releaseA();
    assert.equal(
      (JSON.parse(readFileSync(lockPath(dir), 'utf8')) as LibraryLockRecord).instanceId,
      'instance-b',
      "instance A's stale release left B's lock intact",
    );
  });

  test('re-acquire by the same instance replaces its own record (relaunch after crash where pid changed)', () => {
    const dir = tempDir();
    acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 100, isPidAlive: () => false });
    const release = acquireLibraryLock(dir, 'instance-a', { host: 'mac-a', pid: 101, isPidAlive: () => false });
    assert.equal((JSON.parse(readFileSync(lockPath(dir), 'utf8')) as LibraryLockRecord).pid, 101);
    release();
  });

  test('the default pid-liveness probe: our own pid is alive, an absurd pid is not', () => {
    const dir = tempDir();
    // Held by THIS process on the real host: refused via the real probe.
    acquireLibraryLock(dir, 'instance-a', { pid: process.pid });
    assert.throws(() => acquireLibraryLock(dir, 'instance-b', {}), LibraryLockError);
    const host = (JSON.parse(readFileSync(lockPath(dir), 'utf8')) as LibraryLockRecord).hostname;

    // Held by a pid that cannot exist: stale, reclaimed via the real probe.
    const dir2 = tempDir();
    writeFileSync(lockPath(dir2), JSON.stringify({ instanceId: 'ghost', pid: 2 ** 30, hostname: host, acquiredAt: 'x' }), 'utf8');
    const release = acquireLibraryLock(dir2, 'instance-b', {});
    release();
  });
});
