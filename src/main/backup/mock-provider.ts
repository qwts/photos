import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import {
  assertSafeRemotePath,
  ProviderError,
  type ProviderAuthState,
  type ProviderQuota,
  type RemoteEntry,
  type StorageProvider,
} from './provider.js';

// Filesystem-backed mock provider (#103): the CI/E2E target the whole M08
// epic builds against. Remote paths map onto a local directory; quota and
// auth are simulated. Fault injection lives in FaultInjectingProvider so
// contract tests exercise the same adapter the happy paths use.

export interface MockProviderOptions {
  /** Local directory standing in for the remote root. */
  readonly rootDir: string;
  /** Simulated quota total. Default 10 GiB. */
  readonly totalBytes?: number | undefined;
}

const DEFAULT_TOTAL = 10 * 1024 * 1024 * 1024;

export class MockProvider implements StorageProvider {
  readonly id = 'mock';
  readonly label = 'Local mock';
  private readonly rootDir: string;
  private readonly totalBytes: number;
  private connected = true;

  constructor(options: MockProviderOptions) {
    this.rootDir = options.rootDir;
    this.totalBytes = options.totalBytes ?? DEFAULT_TOTAL;
  }

  /** Test hook: simulate the user disconnecting/reconnecting the provider. */
  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  authState(): Promise<ProviderAuthState> {
    return Promise.resolve(this.connected ? 'connected' : 'not-connected');
  }

  private resolve(path: string): string {
    assertSafeRemotePath(path);
    return join(this.rootDir, ...path.split('/'));
  }

  private assertAuth(): void {
    if (!this.connected) {
      throw new ProviderError('provider is not connected', 'auth');
    }
  }

  async put(path: string, bytes: Readable): Promise<{ bytes: number }> {
    this.assertAuth();
    const target = this.resolve(path);
    const { usedBytes } = await this.quota();
    // Replacements free their old bytes — quota compares FINAL usage
    // (PR #200 review), so an in-quota overwrite is never rejected.
    const existing = await stat(target)
      .then((info) => info.size)
      .catch(() => 0);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(bytes, createWriteStream(target));
    const written = (await stat(target)).size;
    if (usedBytes - existing + written > this.totalBytes) {
      await rm(target, { force: true });
      throw new ProviderError('quota exceeded', 'quota');
    }
    return { bytes: written };
  }

  async getStream(path: string): Promise<Readable> {
    this.assertAuth();
    const target = this.resolve(path);
    try {
      await stat(target);
    } catch {
      throw new ProviderError(`no remote entry at ${path}`, 'not-found');
    }
    return createReadStream(target);
  }

  async list(prefix: string): Promise<readonly RemoteEntry[]> {
    this.assertAuth();
    const dir = this.resolve(prefix);
    let names: string[];
    try {
      names = await readdir(dir, { recursive: true });
    } catch {
      return [];
    }
    const entries: RemoteEntry[] = [];
    for (const name of names) {
      const full = join(dir, name);
      const info = await stat(full).catch(() => null);
      if (info?.isFile() === true) {
        entries.push({ path: `${prefix}/${relative(dir, full).split(sep).join('/')}`, bytes: info.size });
      }
    }
    return entries;
  }

  async delete(path: string): Promise<void> {
    this.assertAuth();
    await rm(this.resolve(path), { force: true });
  }

  async quota(): Promise<ProviderQuota> {
    // No catch: a disconnected provider fails this data call with kind=auth
    // like every other (PR #200 review); an empty/missing root lists as [].
    this.assertAuth();
    let usedBytes = 0;
    for (const entry of await this.list('.')) {
      usedBytes += entry.bytes;
    }
    return { usedBytes, totalBytes: this.totalBytes };
  }

  async verify(path: string): Promise<{ sha256: string; bytes: number }> {
    this.assertAuth();
    const hasher = createHash('sha256');
    await pipeline(await this.getStream(path), hasher);
    const bytes = (await stat(this.resolve(path))).size;
    return { sha256: hasher.digest('hex'), bytes };
  }
}

export type FaultKind = 'put' | 'verify-mismatch' | 'auth-expired' | 'transient-get';

/** Wraps any provider with forced failures — each engine error path gets a
 * deterministic trigger (#103 exit criteria). */
export class FaultInjectingProvider implements StorageProvider {
  readonly id: string;
  readonly label: string;
  private readonly faults = new Set<FaultKind>();

  constructor(private readonly inner: StorageProvider) {
    this.id = inner.id;
    this.label = inner.label;
  }

  arm(fault: FaultKind): void {
    this.faults.add(fault);
  }

  disarm(fault: FaultKind): void {
    this.faults.delete(fault);
  }

  async authState(): Promise<ProviderAuthState> {
    if (this.faults.has('auth-expired')) {
      return 'expired';
    }
    return this.inner.authState();
  }

  async put(path: string, bytes: Readable): Promise<{ bytes: number }> {
    if (this.faults.has('auth-expired')) {
      throw new ProviderError('auth token expired', 'auth');
    }
    if (this.faults.has('put')) {
      throw new ProviderError('injected upload failure', 'transient');
    }
    return this.inner.put(path, bytes);
  }

  async getStream(path: string): Promise<Readable> {
    if (this.faults.has('transient-get')) {
      throw new ProviderError('injected download failure', 'transient');
    }
    return this.inner.getStream(path);
  }

  async list(prefix: string): Promise<readonly RemoteEntry[]> {
    return this.inner.list(prefix);
  }

  async delete(path: string): Promise<void> {
    return this.inner.delete(path);
  }

  async quota(): Promise<ProviderQuota> {
    return this.inner.quota();
  }

  async verify(path: string): Promise<{ sha256: string; bytes: number }> {
    const real = await this.inner.verify(path);
    if (this.faults.has('verify-mismatch')) {
      // Guaranteed-different digest: flip the first hex nibble (a fixed
      // prefix was a no-op 1 time in 16 — ciphertext hashes are random).
      const flipped = real.sha256.startsWith('0') ? '1' : '0';
      return { sha256: `${flipped}${real.sha256.slice(1)}`, bytes: real.bytes };
    }
    return real;
  }
}

/** Provider registry (#103): connection state feeds M09's settings card. */
export class ProviderRegistry {
  private readonly providers = new Map<string, StorageProvider>();

  register(provider: StorageProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): StorageProvider | undefined {
    return this.providers.get(id);
  }

  async connectionStates(): Promise<readonly { id: string; label: string; state: ProviderAuthState }[]> {
    const out = [];
    for (const provider of this.providers.values()) {
      out.push({ id: provider.id, label: provider.label, state: await provider.authState() });
    }
    return out;
  }
}
