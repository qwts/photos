import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  assertSafeRemotePath,
  ProviderError,
  type ProviderAuthState,
  type ProviderQuota,
  type RemoteEntry,
  type StorageProvider,
} from '../provider.js';
import {
  ICloudDriveNativeError,
  type ICloudDriveNativeBridge,
  type ICloudDriveNativeEntry,
  type ICloudDriveNativeListPage,
  type ICloudDriveNativeStatus,
} from './native-bridge.js';

const ROOT = 'Overlook';
const PAGE_SIZE = 1_000;
const LIBRARY_ID = /^[A-Za-z0-9_-]{1,64}$/u;

interface ICloudDriveAuthorityState {
  accountToken: string | null;
}

export interface ICloudDriveProviderOptions {
  readonly bridge: ICloudDriveNativeBridge;
  readonly libraryId: string;
  readonly temporaryRoot?: string;
  /** Deterministic pagination seam; production uses the native maximum. */
  readonly pageSize?: number;
}

function providerError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (!(error instanceof ICloudDriveNativeError)) return new ProviderError('iCloud Drive operation failed', 'transient');
  const kinds: Record<ICloudDriveNativeError['code'], ProviderError['kind']> = {
    unavailable: 'auth',
    unentitled: 'auth',
    'account-unavailable': 'auth',
    'account-changed': 'auth',
    offline: 'transient',
    'materialization-delayed': 'transient',
    conflict: 'transient',
    'not-found': 'not-found',
    'invalid-path': 'corrupt',
    'io-failure': 'transient',
  };
  return new ProviderError('iCloud Drive operation failed', kinds[error.code]);
}

export class ICloudDriveProvider implements StorageProvider {
  readonly id = 'icloud-drive';
  readonly label = 'iCloud Drive';
  readonly capabilities = {
    quota: 'unknown',
    verification: 'download-hash',
    resumableUpload: false,
    platforms: ['darwin'],
    interactiveAuth: false,
    reconnectRequired: false,
  } as const;

  private readonly temporaryRoot: string;

  constructor(
    private readonly options: ICloudDriveProviderOptions,
    private readonly authority: ICloudDriveAuthorityState = { accountToken: null },
  ) {
    if (!LIBRARY_ID.test(options.libraryId)) throw new ProviderError(`unsafe library id: ${options.libraryId}`, 'corrupt');
    if (options.pageSize !== undefined && (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > PAGE_SIZE)) {
      throw new ProviderError('invalid iCloud Drive page size', 'corrupt');
    }
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
  }

  async authState(): Promise<ProviderAuthState> {
    try {
      const status = await this.options.bridge.status();
      if (!status.available || status.accountToken === null) return this.authority.accountToken === null ? 'not-connected' : 'expired';
      if (this.authority.accountToken !== null && this.authority.accountToken !== status.accountToken) return 'expired';
      this.authority.accountToken = status.accountToken;
      return 'connected';
    } catch {
      return this.authority.accountToken === null ? 'not-connected' : 'expired';
    }
  }

  forLibrary(libraryId: string): StorageProvider {
    if (!LIBRARY_ID.test(libraryId)) throw new ProviderError(`unsafe library id: ${libraryId}`, 'corrupt');
    return new ICloudDriveProvider({ ...this.options, libraryId }, this.authority);
  }

  async listLibraries(): Promise<readonly string[]> {
    const entries = await this.listNative(ROOT);
    const candidates = new Map<string, number>();
    for (const entry of entries) {
      const match = /^Overlook\/([A-Za-z0-9_-]{1,64})\/recovery\/bootstrap\.ovrb$/u.exec(entry.path);
      if (match?.[1] !== undefined && !entry.conflicted) candidates.set(match[1], entry.size);
    }
    const libraries: string[] = [];
    for (const [libraryId, expectedBytes] of [...candidates].sort(([left], [right]) => left.localeCompare(right))) {
      const verified = await this.forLibrary(libraryId).verify('recovery/bootstrap.ovrb');
      if (verified.bytes === expectedBytes) libraries.push(libraryId);
    }
    return libraries;
  }

  async put(path: string, bytes: Readable): Promise<{ bytes: number }> {
    const remote = this.remotePath(path);
    const directory = await mkdtemp(join(this.temporaryRoot, 'overlook-icloud-put-'));
    const source = join(directory, 'payload.ovlk');
    try {
      await pipeline(bytes, createWriteStream(source, { flags: 'wx', mode: 0o600 }));
      const size = (await stat(source)).size;
      await this.options.bridge.replaceFile(remote, source, await this.accountToken());
      return { bytes: size };
    } catch (error) {
      throw providerError(error);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async getStream(path: string): Promise<Readable> {
    const materialized = await this.materialize(path);
    const stream = createReadStream(materialized.file);
    const cleanup = (): void => {
      void rm(materialized.directory, { recursive: true, force: true });
    };
    stream.once('close', cleanup);
    return stream;
  }

  async list(prefix: string): Promise<readonly RemoteEntry[]> {
    if (prefix !== '.') assertSafeRemotePath(prefix);
    const normalized = prefix === '.' ? '' : prefix;
    const base = this.libraryRoot();
    const nativePrefix = normalized === '' ? base : `${base}/${normalized}`;
    const entries = await this.listNative(nativePrefix);
    return entries.map((entry) => {
      if (entry.conflicted) throw new ProviderError('iCloud Drive entry has unresolved versions', 'transient');
      const relative = entry.path.startsWith(`${base}/`) ? entry.path.slice(base.length + 1) : '';
      if (relative === '') throw new ProviderError('iCloud Drive returned an entry outside the library', 'corrupt');
      assertSafeRemotePath(relative);
      return { path: relative, bytes: entry.size };
    });
  }

  async delete(path: string): Promise<void> {
    try {
      await this.options.bridge.delete(this.remotePath(path), await this.accountToken());
    } catch (error) {
      if (error instanceof ICloudDriveNativeError && error.code === 'not-found') return;
      throw providerError(error);
    }
  }

  async quota(): Promise<ProviderQuota> {
    await this.accountToken();
    return { usedBytes: 0, totalBytes: null };
  }

  async verify(path: string): Promise<{ sha256: string; bytes: number }> {
    const materialized = await this.materialize(path);
    try {
      const hash = createHash('sha256');
      await pipeline(createReadStream(materialized.file), hash);
      return { sha256: hash.digest('hex'), bytes: (await stat(materialized.file)).size };
    } finally {
      await rm(materialized.directory, { recursive: true, force: true });
    }
  }

  private libraryRoot(): string {
    return `${ROOT}/${this.options.libraryId}`;
  }

  private remotePath(path: string): string {
    assertSafeRemotePath(path);
    return `${this.libraryRoot()}/${path}`;
  }

  private async accountToken(): Promise<string> {
    let status: ICloudDriveNativeStatus;
    try {
      status = await this.options.bridge.status();
    } catch (error) {
      throw providerError(error);
    }
    if (!status.available || status.accountToken === null) throw new ProviderError('iCloud Drive is unavailable', 'auth');
    if (this.authority.accountToken === null) this.authority.accountToken = status.accountToken;
    if (this.authority.accountToken !== status.accountToken) throw new ProviderError('iCloud Drive account changed', 'auth');
    return status.accountToken;
  }

  private async listNative(path: string): Promise<readonly ICloudDriveNativeEntry[]> {
    const accountToken = await this.accountToken();
    const entries: ICloudDriveNativeEntry[] = [];
    let cursor: string | null = null;
    do {
      let page: ICloudDriveNativeListPage;
      try {
        page = await this.options.bridge.list(path, cursor, this.options.pageSize ?? PAGE_SIZE, accountToken);
      } catch (error) {
        throw providerError(error);
      }
      if (page.accountToken !== accountToken) throw new ProviderError('iCloud Drive account changed', 'auth');
      entries.push(...page.entries);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return entries;
  }

  private async materialize(path: string): Promise<{ readonly directory: string; readonly file: string }> {
    const remote = this.remotePath(path);
    const directory = await mkdtemp(join(this.temporaryRoot, 'overlook-icloud-get-'));
    const file = join(directory, 'payload.ovlk');
    try {
      await this.options.bridge.materializeFile(remote, file, await this.accountToken());
      return { directory, file };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw providerError(error);
    }
  }
}
