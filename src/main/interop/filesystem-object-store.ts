import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { assertSafeInteropPath, InteropTransportError, type InteropObjectPage, type InteropObjectStore } from './transport.js';

/** Unpackaged acceptance harness for exercising provider-neutral Move semantics without network custody. */
export class FilesystemInteropObjectStore implements InteropObjectStore {
  readonly provider = 'pcloud' as const;

  constructor(private readonly root: string) {}

  authState(): Promise<'connected'> {
    return Promise.resolve('connected');
  }

  async put(pathInput: string, bytes: Buffer): Promise<{ readonly bytes: number }> {
    const path = this.resolve(pathInput);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { bytes: bytes.length };
  }

  async get(pathInput: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(pathInput));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) throw new InteropTransportError('Interop object was not found.', 'not-found', false);
      throw error;
    }
  }

  async list(prefixInput: string, cursor: string | null): Promise<InteropObjectPage> {
    const prefix = assertSafeInteropPath(prefixInput);
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new InteropTransportError('Invalid interoperability cursor.', 'corrupt', false);
    let names: string[] = [];
    try {
      names = await readdir(this.root, { recursive: true, encoding: 'utf8' });
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    const entries: { path: string; bytes: number }[] = [];
    for (const name of names.sort()) {
      if (!name.startsWith(prefix)) continue;
      const details = await stat(join(this.root, name));
      if (details.isFile()) entries.push({ path: name, bytes: details.size });
    }
    const page = entries.slice(offset, offset + 100);
    return { entries: page, nextCursor: offset + page.length < entries.length ? String(offset + page.length) : null };
  }

  async delete(pathInput: string): Promise<void> {
    try {
      await unlink(this.resolve(pathInput));
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }

  async quota(): Promise<{ readonly usedBytes: number; readonly totalBytes: null }> {
    const entries = await this.list('pairings', null);
    return { usedBytes: entries.entries.reduce((total, entry) => total + entry.bytes, 0), totalBytes: null };
  }

  async verify(pathInput: string): Promise<{ readonly sha256: string; readonly bytes: number }> {
    const bytes = await this.get(pathInput);
    return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }

  private resolve(pathInput: string): string {
    return join(this.root, assertSafeInteropPath(pathInput));
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
