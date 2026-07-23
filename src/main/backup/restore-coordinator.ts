import { openRecoveryKey, RecoveryError } from '../crypto/recovery.js';
import { discoverRestore, type RestoreCandidate, type RestoreDiscovery } from './restore-discovery.js';
import type { RestoreRequest, RestoreRunResult } from './restore-engine.js';
import type { StorageProvider } from './provider.js';
import { RestoreError, toRestoreError, type RestoreProgress } from './restore-types.js';
import type { RestoreDiscoverResponse, RestoreLibrarySummary, RestoreRunResponse } from '../../shared/backup/restore-contract.js';

export interface RestoreSource {
  readonly libraryId: string;
  readonly provider: StorageProvider;
}

interface DiscoveredSource extends RestoreSource {
  readonly discovery: RestoreDiscovery;
}

interface RestoreSession {
  readonly id: string;
  readonly providerId: string;
  readonly masterKey: Buffer;
  readonly custodyPassword: string | null;
  readonly sources: ReadonlyMap<string, DiscoveredSource>;
}

export interface RestoreRunner {
  run(request: RestoreRequest): Promise<RestoreRunResult>;
}

/** How discovery obtains the master key (#741 follow-up): the separately
 * saved recovery-key file, or this machine's own keystore — a library whose
 * keystore is open already holds the very key its cloud backups were sealed
 * under, and demanding the exported file there makes the backup unrestorable
 * for no security gain (the key is ALREADY resident). */
export type RestoreKeySource =
  | { readonly kind: 'recovery-key'; readonly path: string; readonly password: string }
  /** custodyPassword (#754): the app password the facade just verified as
   * fresh authority. It rides the session so activation can re-establish
   * password-derived custody for the restored library. */
  | { readonly kind: 'local-master'; readonly custodyPassword?: string | undefined };

export interface RestoreCoordinatorDeps {
  readonly readRecoveryKey: (path: string) => Promise<Buffer>;
  /** A COPY of the open library's master key, or null when no keystore is
   * available (fresh profile, locked library). Callers own the copy. */
  readonly localMasterKey?: (() => Buffer | null) | undefined;
  readonly sources: (providerId: string) => Promise<readonly RestoreSource[]>;
  readonly createRunner: (provider: StorageProvider, progress: (value: RestoreProgress) => void) => RestoreRunner;
  readonly sessionId: () => string;
  readonly resumeAvailable?: ((libraryId: string, candidate: RestoreCandidate) => Promise<boolean>) | undefined;
  readonly progress: (value: RestoreProgress) => void;
  readonly workStarted?: (() => void) | undefined;
  readonly workFinished?: (() => void) | undefined;
  readonly activated?: ((result: RestoreRunResult) => void) | undefined;
}

function errorResult(error: unknown): { reason: RestoreError['reason']; message: string } {
  if (error instanceof RecoveryError) {
    return {
      reason: error.reason === 'wrong-password' ? 'wrong-key' : 'corrupt',
      message: error.reason === 'wrong-password' ? 'The recovery-key password is incorrect.' : 'This is not an Overlook recovery key.',
    };
  }
  const mapped = toRestoreError(error);
  return { reason: mapped.reason, message: mapped.message };
}

function invalidSummary(libraryId: string, error: RestoreError): RestoreLibrarySummary {
  const validation = error.reason === 'wrong-key' ? 'wrong-key' : error.reason === 'unsupported' ? 'unsupported' : 'corrupt';
  return {
    libraryId,
    generation: null,
    generatedAt: null,
    photos: null,
    totalBytes: null,
    albums: null,
    compatibility: error.reason === 'unsupported' ? 'unsupported' : 'unknown',
    validation,
    fallbackGenerations: 0,
    resumable: false,
  };
}

export class RestoreCoordinator {
  private session: RestoreSession | null = null;
  private controller: AbortController | null = null;
  private readonly active = new Set<Promise<unknown>>();

  constructor(private readonly deps: RestoreCoordinatorDeps) {}

  private clearSession(): void {
    this.session?.masterKey.fill(0);
    this.session = null;
  }

  discover(providerId: string, keyPath: string, password: string): Promise<RestoreDiscoverResponse> {
    return this.discoverFrom(providerId, { kind: 'recovery-key', path: keyPath, password });
  }

  discoverFrom(providerId: string, source: RestoreKeySource): Promise<RestoreDiscoverResponse> {
    return this.track(() => this.discoverOperation(providerId, source));
  }

  private async openMasterKey(source: RestoreKeySource): Promise<Buffer> {
    if (source.kind === 'recovery-key') {
      return openRecoveryKey(await this.deps.readRecoveryKey(source.path), source.password);
    }
    const local = this.deps.localMasterKey?.() ?? null;
    if (local === null) {
      throw new RestoreError('wrong-key', "This Mac's stored key is unavailable. Use the recovery key exported for this library.");
    }
    return local;
  }

  private async discoverOperation(providerId: string, source: RestoreKeySource): Promise<RestoreDiscoverResponse> {
    if (this.controller !== null) {
      return { sessionId: null, libraries: [], error: { reason: 'io', message: 'A restore is already running.' } };
    }
    this.clearSession();
    let masterKey: Buffer;
    try {
      masterKey = await this.openMasterKey(source);
    } catch (error) {
      return { sessionId: null, libraries: [], error: errorResult(error) };
    }

    try {
      const sources = await this.deps.sources(providerId);
      if (sources.length === 0) {
        masterKey.fill(0);
        return { sessionId: null, libraries: [], error: { reason: 'corrupt', message: 'No Overlook cloud libraries were found.' } };
      }
      const valid = new Map<string, DiscoveredSource>();
      const libraries: RestoreLibrarySummary[] = [];
      for (const source of sources) {
        try {
          const discovery = await discoverRestore(source.provider, masterKey);
          const candidate = discovery.candidates[0];
          if (candidate === undefined) throw new RestoreError('corrupt', 'No valid restore generation was found.');
          const discoveredLibraryId = discovery.bootstrap.libraryId;
          valid.set(discoveredLibraryId, { ...source, libraryId: discoveredLibraryId, discovery });
          libraries.push({
            libraryId: discoveredLibraryId,
            generation: candidate.generation,
            generatedAt: candidate.manifest.generatedAt,
            photos: candidate.manifest.totals.photos,
            totalBytes: candidate.manifest.totals.bytes,
            albums: candidate.manifest.totals.albums,
            compatibility: 'compatible',
            validation: 'valid',
            fallbackGenerations: Math.max(0, discovery.candidates.length - 1),
            resumable: (await this.deps.resumeAvailable?.(discoveredLibraryId, candidate)) ?? false,
          });
        } catch (error) {
          const mapped = toRestoreError(error);
          if (mapped.reason === 'auth' || mapped.reason === 'offline' || mapped.reason === 'cancelled') throw mapped;
          libraries.push(invalidSummary(source.libraryId, mapped));
        }
      }
      const id = this.deps.sessionId();
      const custodyPassword = source.kind === 'local-master' ? (source.custodyPassword ?? null) : null;
      this.session = { id, providerId, masterKey, custodyPassword, sources: valid };
      return { sessionId: id, libraries, error: null };
    } catch (error) {
      masterKey.fill(0);
      return { sessionId: null, libraries: [], error: errorResult(error) };
    }
  }

  run(sessionId: string, libraryId: string, allowReplace: boolean): Promise<RestoreRunResponse> {
    return this.track(() => this.runOperation(sessionId, libraryId, allowReplace));
  }

  private async runOperation(sessionId: string, libraryId: string, allowReplace: boolean): Promise<RestoreRunResponse> {
    const session = this.session;
    const source = session?.sources.get(libraryId);
    if (session === null || session.id !== sessionId || source === undefined) {
      return { result: null, error: { reason: 'io', message: 'Restore discovery expired; discover the backup again.' } };
    }
    if (this.controller !== null) {
      return { result: null, error: { reason: 'io', message: 'A restore is already running.' } };
    }
    const controller = new AbortController();
    this.controller = controller;
    this.deps.workStarted?.();
    try {
      const expectedGeneration = source.discovery.newestGeneration;
      const runner = this.deps.createRunner(source.provider, this.deps.progress);
      const result = await runner.run({
        masterKey: session.masterKey,
        allowReplace,
        signal: controller.signal,
        ...(session.custodyPassword === null ? {} : { custodyPassword: session.custodyPassword }),
      });
      this.deps.activated?.(result);
      this.clearSession();
      return {
        result: {
          ...result,
          fallbackFromGeneration: expectedGeneration !== result.generation ? expectedGeneration : null,
          relaunching: true,
        },
        error: null,
      };
    } catch (error) {
      return { result: null, error: errorResult(error) };
    } finally {
      this.controller = null;
      this.deps.workFinished?.();
    }
  }

  cancel(): void {
    this.controller?.abort();
  }

  dispose(): void {
    this.cancel();
    this.clearSession();
  }

  async close(): Promise<void> {
    this.cancel();
    await Promise.allSettled([...this.active]);
    this.clearSession();
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    const active = operation();
    this.active.add(active);
    const remove = () => this.active.delete(active);
    void active.then(remove, remove);
    return active;
  }
}
