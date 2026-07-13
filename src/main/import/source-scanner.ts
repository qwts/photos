import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { classifyMediaFile } from '../../shared/library/media-files.js';
import type { FileKind } from '../../shared/library/types.js';

// Import source discovery + scan (#84): the numbers behind the design's
// source card — "1,204 NEW · 38.2 GB · 812 RAW / 392 JPG". NEW is a
// content-hash presence check against the library (full-file SHA-256, the
// same hash the blob store addresses by), so a re-scan after import reports
// 0 new by construction. Copying is #87; the dialog is #88.

export interface ImportSource {
  readonly path: string;
  readonly label: string;
  readonly kind: 'volume' | 'folder';
}

export interface ScannedFile {
  readonly path: string;
  readonly fileName: string;
  readonly kind: FileKind;
  readonly bytes: number;
  readonly contentHash: string;
  readonly isNew: boolean;
}

export interface SourceScanSummary {
  /** Media files on the source (allowlist only). */
  readonly total: number;
  readonly newCount: number;
  readonly newBytes: number;
  /** RAW/JPG split of the NEW files (the card's "812 RAW / 392 JPG"). */
  readonly newRaw: number;
  readonly newJpg: number;
  /** New non-RAW, non-JPEG media (HEIC/PNG) — not JPGs (PR #174 review). */
  readonly newOther: number;
}

export interface SourceScanProgress extends SourceScanSummary {
  readonly scanned: number;
  readonly done: boolean;
}

export interface SourceScannerDeps {
  /** Library dedupe primitive: does this content hash already exist? */
  readonly hasContentHash: (hash: string) => boolean;
}

/** Progress cadence: big cards report every N files, and always at the end. */
const PROGRESS_EVERY = 25;

async function hashFile(path: string): Promise<string> {
  const hasher = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hasher.update(chunk as Buffer);
  }
  return hasher.digest('hex');
}

async function listMediaFiles(dir: string): Promise<{ path: string; fileName: string; kind: FileKind }[]> {
  const found: { path: string; fileName: string; kind: FileKind }[] = [];
  // Unreadable directories (e.g. "System Volume Information" at a Windows
  // drive root) are skipped, never fatal — one system folder must not sink
  // the whole source-card scan (PR #174 review).
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) {
        found.push(...(await listMediaFiles(entryPath)));
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const kind = classifyMediaFile(entry.name);
    if (kind !== null) {
      found.push({ path: entryPath, fileName: entry.name, kind });
    }
  }
  return found;
}

export async function scanSource(
  dir: string,
  deps: SourceScannerDeps,
  onProgress?: (progress: SourceScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ readonly summary: SourceScanSummary; readonly files: readonly ScannedFile[] }> {
  return scanCandidates(await listMediaFiles(dir), deps, onProgress, signal);
}

/** Dropped-file scan (#237): an explicit path list instead of a directory
 * walk — same allowlist, hashing, and NEW semantics as scanSource. Non-media
 * and unreadable paths are skipped, never fatal. */
export async function scanFiles(
  paths: readonly string[],
  deps: SourceScannerDeps,
  onProgress?: (progress: SourceScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ readonly summary: SourceScanSummary; readonly files: readonly ScannedFile[] }> {
  const candidates: { path: string; fileName: string; kind: FileKind }[] = [];
  for (const path of paths) {
    const fileName = basename(path);
    const kind = classifyMediaFile(fileName);
    if (kind === null) {
      continue;
    }
    try {
      if (!(await stat(path)).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    candidates.push({ path, fileName, kind });
  }
  return scanCandidates(candidates, deps, onProgress, signal);
}

async function scanCandidates(
  candidates: readonly { path: string; fileName: string; kind: FileKind }[],
  deps: SourceScannerDeps,
  onProgress?: (progress: SourceScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ readonly summary: SourceScanSummary; readonly files: readonly ScannedFile[] }> {
  const files: ScannedFile[] = [];
  let newCount = 0;
  let newBytes = 0;
  let newRaw = 0;
  let newJpg = 0;
  let newOther = 0;

  const snapshot = (scanned: number, done: boolean): SourceScanProgress => ({
    total: candidates.length,
    newCount,
    newBytes,
    newRaw,
    newJpg,
    newOther,
    scanned,
    done,
  });

  for (const [index, candidate] of candidates.entries()) {
    if (signal?.aborted === true) {
      break; // cancel promptly — no more hashing I/O (PR #186 review)
    }
    // One unreadable/vanished file must not sink the batch — skip it and
    // keep scanning the rest (PR #249 review; matches the directory walk's
    // skip-unreadable stance).
    let size: number;
    let contentHash: string;
    try {
      size = (await stat(candidate.path)).size;
      contentHash = await hashFile(candidate.path);
    } catch {
      continue;
    }
    const isNew = !deps.hasContentHash(contentHash);
    if (isNew) {
      newCount += 1;
      newBytes += size;
      if (candidate.kind === 'raw') {
        newRaw += 1;
      } else if (candidate.kind === 'jpeg') {
        newJpg += 1;
      } else {
        newOther += 1;
      }
    }
    files.push({ ...candidate, bytes: size, contentHash, isNew });
    if ((index + 1) % PROGRESS_EVERY === 0) {
      onProgress?.(snapshot(index + 1, false));
    }
  }

  onProgress?.(snapshot(candidates.length, true));
  const { scanned: _scanned, done: _done, ...summary } = snapshot(candidates.length, true);
  return { summary, files };
}

export interface VolumeListerDeps {
  readonly platform: NodeJS.Platform;
  /** Directory listing, injectable for tests. */
  readonly listDir: (dir: string) => Promise<string[]>;
  /** True when the entry is a symlink (macOS boot volume in /Volumes). */
  readonly isSymlink: (path: string) => Promise<boolean>;
  /** True when the path exists and is readable (windows drive probe). */
  readonly exists: (path: string) => Promise<boolean>;
}

export function defaultVolumeListerDeps(): VolumeListerDeps {
  return {
    platform: process.platform,
    listDir: async (dir) => readdir(dir),
    isSymlink: async (path) => {
      try {
        return (await lstat(path)).isSymbolicLink();
      } catch {
        return true; // unreadable → treat as not-a-volume
      }
    },
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Removable-volume enumeration, platform-appropriate (#84). */
export async function listVolumes(deps: VolumeListerDeps): Promise<ImportSource[]> {
  if (deps.platform === 'darwin') {
    const entries = await deps.listDir('/Volumes').catch(() => [] as string[]);
    const sources: ImportSource[] = [];
    for (const name of entries) {
      if (name.startsWith('.')) {
        continue;
      }
      const path = join('/Volumes', name);
      // The boot volume appears as a symlink to / — not an import source.
      if (await deps.isSymlink(path)) {
        continue;
      }
      sources.push({ path, label: name, kind: 'volume' });
    }
    return sources;
  }
  if (deps.platform === 'win32') {
    const sources: ImportSource[] = [];
    for (let code = 'D'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
      const letter = String.fromCharCode(code);
      const path = `${letter}:\\`;
      if (await deps.exists(path)) {
        sources.push({ path, label: `${letter}:`, kind: 'volume' });
      }
    }
    return sources;
  }
  // linux: udisks mounts under /media/<user> and /run/media/<user>.
  const user = process.env['USER'] ?? '';
  const roots = [`/media/${user}`, `/run/media/${user}`];
  const sources: ImportSource[] = [];
  for (const root of roots) {
    const entries = await deps.listDir(root).catch(() => [] as string[]);
    for (const name of entries) {
      if (!name.startsWith('.')) {
        sources.push({ path: join(root, name), label: name, kind: 'volume' });
      }
    }
  }
  return sources;
}

/** A user-chosen folder as an import source (the manual path). */
export function folderSource(path: string): ImportSource {
  return { path, label: basename(path), kind: 'folder' };
}
