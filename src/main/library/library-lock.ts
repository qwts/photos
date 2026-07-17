import { hostname } from 'node:os';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    // Stale (dead pid, garbage, or our own previous run): reclaim.
    rmSync(path, { force: true });
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
