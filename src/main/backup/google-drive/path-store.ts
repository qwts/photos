import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INDEX_FILE = 'google-drive-paths.json';

interface LibraryIndex {
  readonly folders: Record<string, string>;
  readonly files: Record<string, string>;
}

interface PathIndex {
  readonly version: 1;
  readonly overlookFolderId: string | null;
  readonly libraries: Record<string, LibraryIndex>;
}

function emptyIndex(): PathIndex {
  return { version: 1, overlookFolderId: null, libraries: {} };
}

function stringMap(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' || entry === '') return null;
    out[key] = entry;
  }
  return out;
}

function parseIndex(value: unknown): PathIndex | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record['version'] !== 1 || (record['overlookFolderId'] !== null && typeof record['overlookFolderId'] !== 'string')) return null;
  const rawLibraries = record['libraries'];
  if (typeof rawLibraries !== 'object' || rawLibraries === null || Array.isArray(rawLibraries)) return null;
  const libraries: Record<string, LibraryIndex> = {};
  for (const [libraryId, raw] of Object.entries(rawLibraries)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(libraryId) || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const folders = stringMap(item['folders']);
    const files = stringMap(item['files']);
    if (folders === null || files === null) return null;
    libraries[libraryId] = { folders, files };
  }
  return { version: 1, overlookFolderId: record['overlookFolderId'], libraries };
}

/** Durable, non-secret Drive IDs. The cache survives library replacement,
 * but every ID is revalidated before first use in a process. */
export class GoogleDrivePathStore {
  private readonly filePath: string;
  private index: PathIndex;

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, INDEX_FILE);
    this.index = this.read();
  }

  overlookFolderId(): string | null {
    return this.index.overlookFolderId;
  }

  setOverlookFolderId(id: string | null): void {
    this.index = { ...this.index, overlookFolderId: id };
    this.write();
  }

  folderId(libraryId: string, path: string): string | null {
    return this.index.libraries[libraryId]?.folders[path] ?? null;
  }

  setFolderId(libraryId: string, path: string, id: string | null): void {
    this.update(libraryId, 'folders', path, id);
  }

  fileId(libraryId: string, path: string): string | null {
    return this.index.libraries[libraryId]?.files[path] ?? null;
  }

  setFileId(libraryId: string, path: string, id: string | null): void {
    this.update(libraryId, 'files', path, id);
  }

  clear(): void {
    this.index = emptyIndex();
    this.write();
  }

  private update(libraryId: string, kind: 'folders' | 'files', path: string, id: string | null): void {
    const current = this.index.libraries[libraryId] ?? { folders: {}, files: {} };
    const entries = { ...current[kind] };
    if (id === null) delete entries[path];
    else entries[path] = id;
    this.index = {
      ...this.index,
      libraries: { ...this.index.libraries, [libraryId]: { ...current, [kind]: entries } },
    };
    this.write();
  }

  private read(): PathIndex {
    if (!existsSync(this.filePath)) return emptyIndex();
    try {
      return parseIndex(JSON.parse(readFileSync(this.filePath, 'utf8'))) ?? emptyIndex();
    } catch {
      return emptyIndex();
    }
  }

  private write(): void {
    mkdirSync(this.dataDir, { recursive: true });
    const staged = `${this.filePath}.tmp`;
    writeFileSync(staged, `${JSON.stringify(this.index)}\n`, { mode: 0o600 });
    renameSync(staged, this.filePath);
  }
}
