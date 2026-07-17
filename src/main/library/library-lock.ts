import { hostname } from 'node:os';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-library single-instance lock (ADR-0017 §5, #385). Advisory: it orders
// honest actors — two app instances on one machine cannot open the same
// library concurrently. Created O_EXCL; a conflict is examined rather than
// trusted: a same-host lock whose pid is dead is stale (crash) and reclaimed,
// a same-host live pid refuses, and a different hostname (network share)
// refuses because liveness cannot be verified across machines.

export class LibraryLockError extends Error {
  override readonly name = 'LibraryLockError';
  constructor(
    message: string,
    readonly reason: 'held-by-instance' | 'held-by-other-host',
  ) {
    super(message);
  }
}

export interface LibraryLockRecord {
  readonly instanceId: string;
  readonly pid: number;
  readonly hostname: string;
  readonly acquiredAt: string;
}

export interface LibraryLockOptions {
  /** Injected for tests. */
  readonly host?: string;
  readonly pid?: number;
  readonly isPidAlive?: (pid: number) => boolean;
  readonly now?: () => Date;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    // Signal 0 performs permission/existence checks without sending anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user — alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function lockPath(dataDir: string): string {
  return join(dataDir, 'library.lock');
}

/** A reclaim guard abandoned by a crashed reclaimer is itself stale after
 * this long — reclaiming is a few filesystem calls, not seconds. */
const RECLAIM_GUARD_STALE_MS = 10_000;

function reclaimStaleLock(path: string, judgedStale: LibraryLockRecord | null, now: () => Date): void {
  const guard = `${path}.reclaim`;
  try {
    if (now().getTime() - statSync(guard).mtimeMs > RECLAIM_GUARD_STALE_MS) rmSync(guard, { force: true });
  } catch {
    // No guard present — the common case.
  }
  try {
    writeFileSync(guard, '', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new LibraryLockError('library is being opened by another Overlook instance', 'held-by-instance');
    }
    throw error;
  }
  try {
    // Delete only if the lock is still byte-for-byte the record we judged
    // stale; anything newer is a live holder and stays.
    const current = existsSync(path) ? readRecord(path) : null;
    if (JSON.stringify(current) === JSON.stringify(judgedStale)) {
      rmSync(path, { force: true });
    }
  } finally {
    rmSync(guard, { force: true });
  }
}

function readRecord(path: string): LibraryLockRecord | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LibraryLockRecord>;
    if (typeof raw.instanceId === 'string' && typeof raw.pid === 'number' && typeof raw.hostname === 'string') {
      return raw as LibraryLockRecord;
    }
  } catch {
    // Unreadable/torn lock: treat as stale below — a half-written lock never
    // proves a live holder, and refusing forever on garbage would wedge the
    // library with no recovery path.
  }
  return null;
}

/** Acquires <dataDir>/library.lock for this instance or throws
 * LibraryLockError. Returns a release function (idempotent; releases only if
 * the file still names this instance). */
export function acquireLibraryLock(dataDir: string, instanceId: string, options: LibraryLockOptions = {}): () => void {
  const path = lockPath(dataDir);
  const host = options.host ?? hostname();
  const pid = options.pid ?? process.pid;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;

  const existing = existsSync(path) ? readRecord(path) : null;
  if (existsSync(path)) {
    if (existing !== null && existing.instanceId !== instanceId) {
      if (existing.hostname !== host) {
        throw new LibraryLockError(
          `library is locked by another computer (${existing.hostname}); locks on shared volumes cannot be verified — close it there or remove ${path} if you are certain`,
          'held-by-other-host',
        );
      }
      if (isPidAlive(existing.pid)) {
        throw new LibraryLockError(
          `library is already open in another Overlook instance (pid ${String(existing.pid)})`,
          'held-by-instance',
        );
      }
    }
    // Stale (dead pid, garbage, or our own previous run): reclaim under a
    // guard. Two post-crash racers must not both delete-then-write — the
    // loser would remove the winner's FRESH lock (PR #425 review). The guard
    // serializes reclaimers, the content re-check ensures only the exact
    // record judged stale is deleted, and the 'wx' write below remains the
    // final arbiter for anyone who slips between.
    reclaimStaleLock(path, existing, options.now ?? (() => new Date()));
  }

  const record: LibraryLockRecord = {
    instanceId,
    pid,
    hostname: host,
    acquiredAt: (options.now?.() ?? new Date()).toISOString(),
  };
  // 'wx' = O_CREAT|O_EXCL: if another instance won the race between our
  // check and this write, this throws EEXIST and the open fails closed.
  try {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new LibraryLockError('library is already open in another Overlook instance', 'held-by-instance');
    }
    throw error;
  }

  return () => {
    const current = existsSync(path) ? readRecord(path) : null;
    if (current?.instanceId === instanceId) {
      rmSync(path, { force: true });
    }
  };
}
