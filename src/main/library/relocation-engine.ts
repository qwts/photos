import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  RELOCATION_MARKER_FILENAME,
  relocationMarkerSchema,
  type RelocationFailureReason,
  type RelocationJournal,
  type RelocationMarker,
  type RelocationMode,
  type RelocationProgress,
  type RelocationResult,
} from '../../shared/library/relocation.js';
import type { LibraryEntry } from '../../shared/library/registry.js';
import { acquireLibraryLock, LibraryLockError, lockPath, type LibraryLockOptions } from './library-lock.js';
import type { RelocationJournalStore } from './relocation-journal.js';

// Relocation engine (ADR-0022 §4/§5, #483): preflight → copy → verify →
// activate → commit → cleanup for an INACTIVE library (the active-library
// quiesce/reopen wrapper arrives with the IPC slice). The source stays
// registered and authoritative until the registry commit; every failure at or
// before the commit discards staging and leaves the source untouched — there
// is no degrade-to-copy outcome. The only two-copies end state is a cleanup
// failure after commit, reported as moved-cleanup-pending, never guessed at.

export class RelocationError extends Error {
  override readonly name = 'RelocationError';
  constructor(
    readonly reason: RelocationFailureReason,
    message: string,
  ) {
    super(message);
  }
}

/** Copy-mode headroom beyond the library's byte size (ADR-0022 §5: size plus
 * scratch) — covers directory overhead and the marker/journal writes. */
const SCRATCH_BYTES = 32 * 1024 * 1024;

/** Never copied: the advisory lock is instance state, not library state, and
 * a top-level relocation.json in the source is an orphaned marker from an
 * abandoned attempt (inert repair debris per ADR-0022 §3), not content. */
const EXCLUDED_FILES = new Set(['library.lock', 'library.lock.reclaim', RELOCATION_MARKER_FILENAME]);

export function stagingPathFor(destDir: string): string {
  return `${destDir}.relocate-staging`;
}

interface SourceFile {
  readonly rel: string;
  readonly size: number;
}

export interface RelocationDeps {
  readonly journals: RelocationJournalStore;
  readonly registry: {
    get(id: string): LibraryEntry | undefined;
    updatePath(id: string, newPath: string): LibraryEntry;
    list(): readonly LibraryEntry[];
  };
  readonly instanceId: string;
  readonly now?: () => Date;
  readonly nonce?: () => string;
  /** Injected for tests; default probes the destination volume. */
  readonly freeBytes?: (dir: string) => number;
  readonly sameVolume?: (a: string, b: string) => boolean;
  /** Returns a human-readable objection (e.g. "FAT32") or null. Real
   * detection lands with the preflight UI slice; the hook keeps the refusal
   * reason stable (ADR-0022 §5). */
  readonly unsupportedFilesystem?: (dir: string) => string | null;
  readonly lockOptions?: LibraryLockOptions;
  /** Post-digest health check (staged DB opens with existing custody) —
   * wired to the keystore in the IPC slice. */
  readonly verifyOpenable?: (dir: string) => Promise<void>;
  /** Injected failure points for the crash/cleanup matrix in tests. */
  readonly ops?: {
    readonly rename?: typeof rename;
    readonly rmrf?: (target: string) => Promise<void>;
  };
}

export interface RelocateOptions {
  readonly libraryId: string;
  /** Final destination directory (absent, or an existing EMPTY directory). */
  readonly destDir: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RelocationProgress) => void;
}

const defaultRmrf = (target: string): Promise<void> => rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });

function opsOf(deps: RelocationDeps): { rename: typeof rename; rmrf: (target: string) => Promise<void> } {
  return { rename: deps.ops?.rename ?? rename, rmrf: deps.ops?.rmrf ?? defaultRmrf };
}

function defaultFreeBytes(dir: string): number {
  const fsStat = statfsSync(dir);
  return Number(fsStat.bavail) * Number(fsStat.bsize);
}

function defaultSameVolume(a: string, b: string): boolean {
  return statSync(a).dev === statSync(b).dev;
}

export function readMarker(dir: string): RelocationMarker | null {
  try {
    const parsed = relocationMarkerSchema.safeParse(JSON.parse(readFileSync(path.join(dir, RELOCATION_MARKER_FILENAME), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    // Missing or garbage marker: not relocation staging we can vouch for.
    return null;
  }
}

async function writeMarker(dir: string, marker: RelocationMarker): Promise<void> {
  await writeFile(path.join(dir, RELOCATION_MARKER_FILENAME), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

async function walkSource(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(path.join(root, rel), { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel === '' ? entry.name : path.join(rel, entry.name);
      if (entry.isDirectory()) {
        await walk(entryRel);
      } else if (entry.isFile()) {
        if (rel === '' && EXCLUDED_FILES.has(entry.name)) continue;
        files.push({ rel: entryRel, size: (await stat(path.join(root, entryRel))).size });
      } else {
        // Symlinks or specials inside a library are outside the ADR-0005
        // layout — copying them "somehow" could silently change meaning.
        throw new RelocationError('source-unreadable', `unsupported entry in library: ${entryRel}`);
      }
    }
  }
  await walk('');
  return files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

async function copyFileHashed(from: string, to: string): Promise<string> {
  await mkdir(path.dirname(to), { recursive: true });
  const hash = createHash('sha256');
  const tee = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(from), tee, createWriteStream(to, { flags: 'wx' }));
  return hash.digest('hex');
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  const sink = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null);
    },
  });
  await pipeline(createReadStream(file), sink);
  return hash.digest('hex');
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new RelocationError('cancelled', 'relocation cancelled');
}

/** Clears the destination slot with a non-recursive remove, so content that
 * appeared after preflight is refused, never deleted — preflight's emptiness
 * check is stale by activation time on a long copy. */
async function removeIfEmptyDir(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'ENOTEMPTY' || code === 'EEXIST') {
      throw new RelocationError('destination-not-empty', `${dir} gained content during the move — refusing to overwrite`);
    }
    if (code === 'ENOTDIR') {
      throw new RelocationError('invalid-destination', `${dir} exists and is not a folder`);
    }
    throw error;
  }
}

interface Preflight {
  readonly sourceDir: string;
  readonly destDir: string;
  readonly mode: RelocationMode;
  readonly files: readonly SourceFile[];
  readonly totalBytes: number;
}

async function preflight(deps: RelocationDeps, entry: LibraryEntry, destDirRaw: string): Promise<Preflight> {
  const sourceDir = path.resolve(entry.path);
  const destDir = path.resolve(destDirRaw);
  const destParent = path.dirname(destDir);

  const stagingDir = stagingPathFor(destDir);
  const inside = (parent: string, child: string): boolean => child === parent || child.startsWith(parent + path.sep);
  if (inside(sourceDir, destDir) || inside(destDir, sourceDir)) {
    throw new RelocationError('invalid-destination', 'destination must be outside the library it moves');
  }
  for (const registered of deps.registry.list()) {
    if (registered.id === entry.id) continue;
    const registeredPath = path.resolve(registered.path);
    if (inside(registeredPath, destDir) || inside(destDir, registeredPath)) {
      throw new RelocationError('destination-registered', `destination is the registered library "${registered.name}"`);
    }
    if (inside(registeredPath, stagingDir) || inside(stagingDir, registeredPath)) {
      throw new RelocationError('destination-registered', `staging path is the registered library "${registered.name}"`);
    }
  }
  if (existsSync(destDir)) {
    const destStat = lstatSync(destDir);
    if (!destStat.isDirectory()) {
      throw new RelocationError('invalid-destination', 'destination exists and is not a folder');
    }
    if ((await readdir(destDir)).length > 0) {
      throw new RelocationError('destination-not-empty', 'destination folder is not empty — never overwrite or merge (ADR-0022 §5)');
    }
  }
  // The staging path is claimed only when it is provably ours: a directory
  // there carrying another library's marker — or no marker and any content —
  // is somebody's data, and the marker, not the name, defines staging
  // (ADR-0022 §3).
  if (
    existsSync(stagingDir) &&
    readMarker(stagingDir)?.libraryId !== entry.id &&
    (!lstatSync(stagingDir).isDirectory() || (await readdir(stagingDir)).length > 0)
  ) {
    throw new RelocationError(
      'destination-not-empty',
      `a directory already occupies the staging path ${stagingDir} and is not this library's relocation staging`,
    );
  }
  try {
    accessSync(destParent, constants.W_OK | constants.X_OK);
  } catch {
    throw new RelocationError('destination-not-writable', `cannot write to ${destParent}`);
  }
  const objection = deps.unsupportedFilesystem?.(destParent) ?? null;
  if (objection !== null) {
    throw new RelocationError('unsupported-filesystem', objection);
  }

  let files: readonly SourceFile[];
  try {
    files = await walkSource(sourceDir);
  } catch (error) {
    if (error instanceof RelocationError) throw error;
    throw new RelocationError('source-unreadable', error instanceof Error ? error.message : String(error));
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const mode: RelocationMode = (deps.sameVolume ?? defaultSameVolume)(sourceDir, destParent) ? 'rename' : 'copy';
  if (mode === 'copy') {
    const free = (deps.freeBytes ?? defaultFreeBytes)(destParent);
    if (free < totalBytes + SCRATCH_BYTES) {
      throw new RelocationError(
        'insufficient-space',
        `need ${String(totalBytes + SCRATCH_BYTES)} bytes free, destination has ${String(free)}`,
      );
    }
  }
  return { sourceDir, destDir, mode, files, totalBytes };
}

async function verifyStaging(
  deps: RelocationDeps,
  stagingDir: string,
  libraryId: string,
  files: readonly SourceFile[],
  digests: ReadonlyMap<string, string>,
  signal: AbortSignal | undefined,
  progress: (done: number) => void,
): Promise<void> {
  const staged = await walkSource(stagingDir);
  if (staged.length !== files.length) {
    throw new RelocationError('verification-failed', `staged ${String(staged.length)} files, expected ${String(files.length)}`);
  }
  let done = 0;
  for (const [index, file] of files.entries()) {
    throwIfCancelled(signal);
    const stagedFile = staged[index];
    if (stagedFile === undefined || stagedFile.rel !== file.rel) {
      throw new RelocationError('verification-failed', `missing or misplaced file: ${file.rel}`);
    }
    if (stagedFile.size !== file.size) {
      throw new RelocationError('verification-failed', `size mismatch for ${file.rel}`);
    }
    const digest = await hashFile(path.join(stagingDir, file.rel));
    if (digest !== digests.get(file.rel)) {
      throw new RelocationError('verification-failed', `digest mismatch for ${file.rel}`);
    }
    done += 1;
    progress(done);
  }
  const stagedId = (await readFile(path.join(stagingDir, 'library-id'), 'utf8').catch(() => '')).trim();
  if (stagedId !== libraryId) {
    throw new RelocationError('verification-failed', `staged library-id "${stagedId}" does not match ${libraryId}`);
  }
  await deps.verifyOpenable?.(stagingDir);
}

/** Moves an inactive, unlocked library per ADR-0022 §4. The caller owns
 * quiescing an ACTIVE library first (teardown → this → reopen). */
export async function relocateLibrary(deps: RelocationDeps, options: RelocateOptions): Promise<RelocationResult> {
  const entry = deps.registry.get(options.libraryId);
  if (entry === undefined) throw new RelocationError('io-error', `library ${options.libraryId} is not registered`);
  const ops = opsOf(deps);

  let release: () => void;
  try {
    release = acquireLibraryLock(path.resolve(entry.path), deps.instanceId, deps.lockOptions);
  } catch (error) {
    if (error instanceof LibraryLockError) throw new RelocationError('locked', error.message);
    throw error;
  }

  try {
    const emit = (progress: RelocationProgress): void => options.onProgress?.(progress);
    emit({ phase: 'preflight', copiedItems: 0, totalItems: 0, copiedBytes: 0, totalBytes: 0 });
    const plan = await preflight(deps, entry, options.destDir);
    const totals = { totalItems: plan.files.length, totalBytes: plan.totalBytes };
    throwIfCancelled(options.signal);

    const journal: RelocationJournal = deps.journals.save({
      version: 1,
      libraryId: entry.id,
      nonce: deps.nonce?.() ?? `${String(process.pid)}-${String((deps.now?.() ?? new Date()).getTime())}`,
      sourcePath: plan.sourceDir,
      destPath: plan.destDir,
      stagingPath: stagingPathFor(plan.destDir),
      mode: plan.mode,
      state: 'copying',
      startedAt: (deps.now?.() ?? new Date()).toISOString(),
    });
    const marker: RelocationMarker = { version: 1, libraryId: entry.id, nonce: journal.nonce };

    // Any failure before the registry commit: discard staging, clear the
    // journal, leave the source untouched and registered (ADR-0022 §4).
    // Discard removes only what the marker proves is this attempt's staging
    // (or an empty shell we created before the marker landed) — a refusal
    // must never turn around and delete the directory it refused to touch.
    const discardAndRethrow = async (error: unknown): Promise<never> => {
      if (plan.mode === 'copy') {
        if (readMarker(journal.stagingPath)?.nonce === journal.nonce) {
          await ops.rmrf(journal.stagingPath).catch(() => undefined);
        } else {
          await removeIfEmptyDir(journal.stagingPath).catch(() => undefined);
        }
      } else {
        await rm(path.join(plan.sourceDir, RELOCATION_MARKER_FILENAME), { force: true }).catch(() => undefined);
      }
      deps.journals.clear(entry.id);
      throw error;
    };

    try {
      if (plan.mode === 'copy') {
        // Marker-bound debris from an abandoned attempt for THIS library is
        // replaced; anything else at the staging path survives — non-recursive
        // removal refuses occupied directories (re-checked here because
        // preflight's view can be stale).
        if (readMarker(journal.stagingPath)?.libraryId === entry.id) {
          await ops.rmrf(journal.stagingPath);
        } else {
          await removeIfEmptyDir(journal.stagingPath);
        }
        await mkdir(journal.stagingPath, { recursive: true });
        await writeMarker(journal.stagingPath, marker);

        const digests = new Map<string, string>();
        let copiedItems = 0;
        let copiedBytes = 0;
        for (const file of plan.files) {
          throwIfCancelled(options.signal);
          digests.set(file.rel, await copyFileHashed(path.join(plan.sourceDir, file.rel), path.join(journal.stagingPath, file.rel)));
          copiedItems += 1;
          copiedBytes += file.size;
          emit({ phase: 'copying', copiedItems, copiedBytes, ...totals });
        }
        await verifyStaging(deps, journal.stagingPath, entry.id, plan.files, digests, options.signal, (done) =>
          emit({ phase: 'verifying', copiedItems: done, copiedBytes, ...totals }),
        );
        deps.journals.advance(journal, 'verified');

        throwIfCancelled(options.signal);
        await removeIfEmptyDir(plan.destDir); // refuses content that appeared since preflight
        await ops.rename(journal.stagingPath, plan.destDir);
      } else {
        await writeMarker(plan.sourceDir, marker);
        deps.journals.advance(journal, 'verified'); // rename is all-or-nothing; intent recorded, nothing to verify byte-wise
        throwIfCancelled(options.signal);
        await removeIfEmptyDir(plan.destDir);
        await ops.rename(plan.sourceDir, plan.destDir);
      }
    } catch (error) {
      await discardAndRethrow(
        error instanceof RelocationError ? error : new RelocationError('io-error', error instanceof Error ? error.message : String(error)),
      );
    }

    // Commit point (ADR-0022 §4 step 5): before this line the source is
    // authoritative; after it, the destination is. Recovery treats the
    // registry as the arbiter for a crash inside this sequence.
    emit({ phase: 'committing', copiedItems: totals.totalItems, copiedBytes: totals.totalBytes, ...totals });
    deps.registry.updatePath(entry.id, plan.destDir);
    deps.journals.advance(journal, 'committed');
    await rm(path.join(plan.destDir, RELOCATION_MARKER_FILENAME), { force: true });
    await rm(lockPath(plan.destDir), { force: true }); // rename mode: our own lock traveled with the directory

    const result = { mode: plan.mode, items: totals.totalItems, bytes: totals.totalBytes };
    if (plan.mode === 'copy') {
      emit({ phase: 'cleaning', copiedItems: totals.totalItems, copiedBytes: totals.totalBytes, ...totals });
      try {
        await ops.rmrf(plan.sourceDir);
      } catch {
        // The one sanctioned two-copies end state: both verified, journal
        // stays 'committed', retry finishes cleanup. Never guess.
        return { outcome: 'moved-cleanup-pending', ...result };
      }
    }
    deps.journals.advance(journal, 'cleaned');
    deps.journals.clear(entry.id);
    return { outcome: 'moved', ...result };
  } finally {
    release();
  }
}

/** Retries the post-commit source removal for a moved-cleanup-pending
 * library (ADR-0022 §4 step 7 / #483 acceptance 10). */
export async function finishRelocationCleanup(deps: RelocationDeps, libraryId: string): Promise<'cleaned' | 'nothing-pending'> {
  const journal = deps.journals.load(libraryId);
  if (journal === null || journal.state !== 'committed') return 'nothing-pending';
  const ops = opsOf(deps);
  await rm(path.join(journal.destPath, RELOCATION_MARKER_FILENAME), { force: true });
  if (existsSync(journal.sourcePath) && path.resolve(journal.sourcePath) !== path.resolve(journal.destPath)) {
    await ops.rmrf(journal.sourcePath);
  }
  deps.journals.advance(journal, 'cleaned');
  deps.journals.clear(libraryId);
  return 'cleaned';
}

export type RecoveryAction = 'discarded' | 'commit-completed' | 'cleanup-finished' | 'cleanup-pending' | 'corrupt-journal' | 'inconsistent';

export interface RecoveryReport {
  readonly libraryId: string;
  readonly action: RecoveryAction;
  readonly detail?: string;
}

/** Startup recovery (ADR-0022 §2): acts only on what journals record. Pre-
 * commit interruptions discard staging (resume arrives with the wizard
 * slice); post-commit interruptions finish cleanup. Disk state matching no
 * journal is never touched. */
export async function recoverRelocations(deps: RelocationDeps): Promise<RecoveryReport[]> {
  const reports: RecoveryReport[] = [];
  for (const item of deps.journals.list()) {
    if (item.journal instanceof Error) {
      reports.push({ libraryId: item.libraryId, action: 'corrupt-journal', detail: item.journal.message });
      continue;
    }
    reports.push(await recoverOne(deps, item.journal));
  }
  return reports;
}

async function recoverOne(deps: RelocationDeps, journal: RelocationJournal): Promise<RecoveryReport> {
  const ops = opsOf(deps);
  const { libraryId } = journal;
  const markerMatches = (dir: string): boolean => {
    const marker = readMarker(dir);
    return marker !== null && marker.libraryId === libraryId && marker.nonce === journal.nonce;
  };
  const registryAtDest = path.resolve(deps.registry.get(libraryId)?.path ?? '') === path.resolve(journal.destPath);

  if (journal.state === 'cleaned') {
    deps.journals.clear(libraryId);
    return { libraryId, action: 'cleanup-finished' };
  }
  if (journal.state === 'committed' || registryAtDest) {
    // Committed (possibly a crash between the registry rewrite and the
    // journal advance — the registry is the arbiter): finish the move.
    if (!registryAtDest) deps.registry.updatePath(libraryId, journal.destPath);
    if (journal.state !== 'committed') deps.journals.advance(journal, 'committed');
    try {
      await finishRelocationCleanup(deps, libraryId);
      return { libraryId, action: journal.state === 'committed' ? 'cleanup-finished' : 'commit-completed' };
    } catch (error) {
      return { libraryId, action: 'cleanup-pending', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // Pre-commit: the source is authoritative. Discard destination-side state,
  // but only state the marker proves is ours (ADR-0022 §3).
  if (journal.mode === 'copy') {
    if (existsSync(journal.stagingPath) && markerMatches(journal.stagingPath)) {
      await ops.rmrf(journal.stagingPath);
    }
    if (existsSync(journal.destPath) && markerMatches(journal.destPath)) {
      // Crash between activation rename and commit: still marker-bound, still
      // staging, and the source is intact — discard.
      await ops.rmrf(journal.destPath);
    }
    deps.journals.clear(libraryId);
    return { libraryId, action: 'discarded' };
  }

  // Rename mode: exactly one directory holds the library.
  if (existsSync(journal.sourcePath)) {
    await rm(path.join(journal.sourcePath, RELOCATION_MARKER_FILENAME), { force: true });
    deps.journals.clear(libraryId);
    return { libraryId, action: 'discarded' };
  }
  if (existsSync(journal.destPath) && markerMatches(journal.destPath)) {
    // The rename happened; only one copy exists, so the journal rolls the
    // commit forward (ADR-0022 §4 — the journal wins).
    const destId = (await readFile(path.join(journal.destPath, 'library-id'), 'utf8').catch(() => '')).trim();
    if (destId !== libraryId) {
      return { libraryId, action: 'inconsistent', detail: `directory at ${journal.destPath} carries library-id "${destId}"` };
    }
    deps.registry.updatePath(libraryId, journal.destPath);
    await rm(path.join(journal.destPath, RELOCATION_MARKER_FILENAME), { force: true });
    await rm(lockPath(journal.destPath), { force: true });
    deps.journals.clear(libraryId);
    return { libraryId, action: 'commit-completed' };
  }
  return { libraryId, action: 'inconsistent', detail: 'neither source nor a marker-bound destination exists' };
}
