import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { classifyMediaFile } from '../../shared/library/media-files.js';
import { sniffImageKind, sniffVideoKind } from '../../shared/library/media-signatures.js';
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

export interface ImportCandidate {
  readonly path: string;
  readonly fileName: string;
  readonly kind: FileKind;
}

export interface SourceScanSummary {
  /** Importable media on the source: allowlisted AND signature-valid. Excludes
   * containers that fail the signature gate and vanished/unreadable files, so
   * `total === 0` means "nothing here can be imported" (#745 review). */
  readonly total: number;
  readonly newCount: number;
  readonly newBytes: number;
  /** RAW/JPG split of the NEW files (the card's "812 RAW / 392 JPG"). */
  readonly newRaw: number;
  readonly newJpg: number;
  /** New non-RAW, non-JPEG media (HEIC/PNG/GIF/WebP) — not JPGs (PR #174 review). */
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
const PACKAGE_DIRECTORY_SUFFIXES = ['.app', '.bundle', '.framework', '.photoslibrary', '.photolibrary', '.pkg'] as const;

function isPackageDirectory(name: string): boolean {
  const lower = name.toLocaleLowerCase('en-US');
  return PACKAGE_DIRECTORY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

async function hashFile(path: string): Promise<string> {
  const hasher = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hasher.update(chunk as Buffer);
  }
  return hasher.digest('hex');
}

// A container header large enough for every signature the import engine checks:
// image magic bytes and the MPEG-TS 188/192 sync cadence (a handful of packets).
const SNIFF_HEADER_BYTES = 64 * 1024;

async function readHeader(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Container kinds (video/audio) are only real if their bytes say so. This is the
// SAME decision import-engine makes before it will insert a row (#548): a still
// signature wins first, then a container signature; neither → the file will be
// rejected at import, so the scan must not promise it as importable.
async function isImportableContainer(path: string): Promise<boolean> {
  const header = await readHeader(path, SNIFF_HEADER_BYTES);
  return (sniffImageKind(header) ?? sniffVideoKind(header)) !== null;
}

async function listMediaFiles(dir: string, signal?: AbortSignal): Promise<ImportCandidate[]> {
  const found: ImportCandidate[] = [];
  // Unreadable directories (e.g. "System Volume Information" at a Windows
  // drive root) are skipped, never fatal — one system folder must not sink
  // the whole source-card scan (PR #174 review).
  let entries;
  try {
    if ((await lstat(dir)).isSymbolicLink()) return found;
    entries = (await readdir(dir, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (signal?.aborted === true) break;
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !isPackageDirectory(entry.name)) {
        found.push(...(await listMediaFiles(entryPath, signal)));
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
  return scanCandidates(await listMediaFiles(dir, signal), deps, onProgress, signal);
}

/** Dropped-entry scan (#237/#406): files and recursively expanded folders use
 * the same allowlist, hashing, NEW, cancellation, and unreadable-path rules. */
export async function scanFiles(
  paths: readonly string[],
  deps: SourceScannerDeps,
  onProgress?: (progress: SourceScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ readonly summary: SourceScanSummary; readonly files: readonly ScannedFile[] }> {
  return scanCandidates(await collectMediaCandidates(paths, signal), deps, onProgress, signal);
}

/** Expands file/folder paths through the import allowlist without hashing.
 * Cloud and test sources use this to preserve the original display name while
 * still sharing the exact local-source admission policy. */
export async function collectMediaCandidates(paths: readonly string[], signal?: AbortSignal): Promise<ImportCandidate[]> {
  const candidates = new Map<string, ImportCandidate>();
  const add = (candidate: ImportCandidate): void => {
    const key = process.platform === 'win32' || process.platform === 'darwin' ? candidate.path.toLocaleLowerCase('en-US') : candidate.path;
    candidates.set(key, candidate);
  };
  for (const droppedPath of paths) {
    if (signal?.aborted === true) break;
    const absolute = resolve(droppedPath);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        for (const candidate of await listMediaFiles(absolute, signal)) add(candidate);
      } else if (info.isFile()) {
        const fileName = basename(absolute);
        const kind = classifyMediaFile(fileName);
        if (kind !== null) add({ path: absolute, fileName, kind });
      }
    } catch {
      continue;
    }
  }
  return [...candidates.values()];
}

export async function scanCandidates(
  candidates: readonly ImportCandidate[],
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
    // Survivors only, not candidates.length: a container that fails the
    // signature gate (or a vanished/unreadable file) is not importable, so it
    // must not keep `total` nonzero — callers use `total === 0` as the
    // no-supported-files signal (#745 review).
    total: files.length,
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
      // Signature-gate container kinds before hashing so the ready count never
      // promises an import the engine will reject (#548): a `.ts`/audio file
      // whose bytes are not a recognized media signature is dropped here, and —
      // because import re-scans through this same path — never even attempted.
      if ((candidate.kind === 'video' || candidate.kind === 'audio') && !(await isImportableContainer(candidate.path))) {
        continue;
      }
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
