import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { ProtectedBlobStore } from '../blobs/protected-blob-store.js';
import type { BlobStore } from '../blobs/blob-store.js';
import { ProtectedBackupService } from '../backup/protected-backup-service.js';
import { protectedObjectPath } from '../backup/protected-object-path.js';
import type { BackupEngineDeps } from '../backup/backup-engine.js';
import type { StorageProvider } from '../backup/provider.js';
import type { EnvelopeKey, KeyResolver } from '../crypto/envelope.js';
import { ProtectedAlbumAuthorityRegistry } from '../crypto/protected-album-authority.js';
import { ProtectedAlbumService } from '../crypto/protected-album-service.js';
import { ProtectedPhotoMigrationService } from '../crypto/protected-photo-migration-service.js';
import { ProtectedAlbumRepository } from '../db/protected-album-repository.js';
import { ProtectedPhotoMigrationRepository } from '../db/protected-photo-migration-repository.js';
import { ProtectedRecoveryRepository, type ProtectedRemoteObject } from '../db/protected-recovery-repository.js';
import { PhotosRepository } from '../db/photos-repository.js';
import { createProtectedExportRuntime, type DrainableProtectedExportFacade } from '../export/protected-export-runtime.js';
import { ProtectedLibraryService } from './protected-library-service.js';
import { ProtectedMediaService } from './protected-media-service.js';
import { ProtectedWorkflowService, type ProtectedWorkflowProgress } from './protected-workflow-service.js';

export interface ProtectedRuntimeOptions {
  readonly dataDir: string;
  readonly db: BetterSqlite3.Database;
  readonly libraryId: string;
  readonly ordinaryBlobs: BlobStore;
  readonly masterKey: () => Buffer;
  readonly resolveLibraryKey: () => KeyResolver;
  readonly currentLibraryKey: () => EnvelopeKey;
  readonly oweManifest: () => void;
  readonly revokeOrdinary: (photoIds: readonly string[]) => void;
  readonly progress: (done: number, total: number) => void;
  readonly pickDestination: () => Promise<string | null>;
  readonly failure: () => void;
  readonly repairFailure: () => void;
  readonly workflowProgress: (progress: ProtectedWorkflowProgress) => void;
  readonly workflowChanged: () => void;
  readonly ordinaryChanged: (photoIds: readonly string[]) => void;
}

/** Owns the independently authorized protected domain and every decrypted
 * cache/export generation derived from it. */
export class ProtectedRuntime {
  readonly albums: ProtectedAlbumService;
  readonly library: ProtectedLibraryService;
  readonly migrations: ProtectedPhotoMigrationService;
  readonly recovery: ProtectedRecoveryRepository;
  readonly workflow: ProtectedWorkflowService;
  private readonly authorities = new ProtectedAlbumAuthorityRegistry();
  private readonly blobs: ProtectedBlobStore;
  private mediaService: ProtectedMediaService | undefined;
  private exportFacade: DrainableProtectedExportFacade | undefined;

  constructor(private readonly options: ProtectedRuntimeOptions) {
    this.blobs = new ProtectedBlobStore(options.dataDir);
    const blobsReady = this.blobs.init();
    const photos = new ProtectedPhotoMigrationRepository(options.db);
    const ordinaryPhotos = new PhotosRepository(options.db);
    const albumRecords = new ProtectedAlbumRepository(options.db, options.libraryId);
    this.recovery = new ProtectedRecoveryRepository(options.db);
    this.albums = new ProtectedAlbumService({
      libraryId: options.libraryId,
      repository: albumRecords,
      authorities: this.authorities,
    });
    this.library = new ProtectedLibraryService({
      libraryId: options.libraryId,
      albums: albumRecords,
      photos,
      blobs: this.blobs,
      blobsReady,
      authorities: this.authorities,
    });
    this.migrations = new ProtectedPhotoMigrationService({
      libraryId: options.libraryId,
      ordinaryBlobs: options.ordinaryBlobs,
      protectedBlobs: this.blobs,
      photos: ordinaryPhotos,
      migrations: photos,
      oweManifest: options.oweManifest,
      revokeOrdinary: options.revokeOrdinary,
    });
    this.workflow = new ProtectedWorkflowService({
      albums: this.albums,
      albumRecords,
      authorities: this.authorities,
      migrations: this.migrations,
      photos: ordinaryPhotos,
      masterKey: options.masterKey,
      resolveLibraryKey: options.resolveLibraryKey,
      currentLibraryKey: options.currentLibraryKey,
      progress: options.workflowProgress,
      changed: options.workflowChanged,
      ordinaryChanged: options.ordinaryChanged,
    });
    void blobsReady.then(() => this.migrations.repairStartup()).catch(options.repairFailure);
  }

  backupBinding(provider: StorageProvider, audit: (line: string) => void): NonNullable<BackupEngineDeps['protectedBackup']> {
    const service = new ProtectedBackupService({
      provider,
      repository: this.recovery,
      blobs: this.blobs,
      authorities: this.authorities,
      now: () => new Date(),
      audit,
    });
    return {
      run: (signal) => service.run(signal),
      scrub: () => service.scrub(),
      hasManifestDebt: () => this.recovery.hasManifestDebt(),
      reconcileMissing: (paths) => this.reconcileMissingProtected(paths),
      snapshot: () => this.recovery.snapshot(),
      settleManifest: (snapshot) => this.recovery.settleManifest(snapshot),
    };
  }

  /** The provider-switch guard's protected half (#741): claims worklist,
   * local-ciphertext presence, re-queue, and the error→offloaded heal. */
  switchGuardBinding(): {
    readonly claims: () => readonly ProtectedRemoteObject[];
    readonly hasLocal: (albumId: string, blobRef: string, kind: ProtectedRemoteObject['kind']) => boolean;
    readonly requeue: (object: ProtectedRemoteObject) => void;
    readonly heal: (object: ProtectedRemoteObject) => void;
  } {
    return {
      claims: () => this.recovery.remoteClaims(),
      hasLocal: (albumId, blobRef, kind) => this.blobs.has(albumId, blobRef, kind),
      requeue: (object) => this.recovery.requeue(object),
      heal: (object) => this.recovery.healRemote(object),
    };
  }

  /** Manifest-preflight reconciliation (#741): a protected object the
   * selected provider is missing re-queues through the verified upload path
   * when its ciphertext is still local; a remote-only object blocks the
   * publication closed. */
  private reconcileMissingProtected(paths: readonly string[]): { requeued: number; blocked: number } {
    const wanted = new Set(paths);
    let requeued = 0;
    let blocked = 0;
    for (const object of this.recovery.remoteClaims()) {
      if (object.status === 'error' || !wanted.has(protectedObjectPath(object.blobRef, object.kind))) continue;
      if (object.status === 'synced' && this.blobs.has(object.albumId, object.blobRef, object.kind)) {
        this.recovery.requeue(object);
        requeued += 1;
      } else {
        blocked += 1;
      }
    }
    return { requeued, blocked };
  }

  media(): ProtectedMediaService {
    this.mediaService ??= new ProtectedMediaService({ library: this.library, authorities: this.authorities });
    return this.mediaService;
  }

  exports(): DrainableProtectedExportFacade {
    this.exportFacade ??= createProtectedExportRuntime({
      library: this.library,
      progress: this.options.progress,
      pickDestination: this.options.pickDestination,
      failure: this.options.failure,
    });
    return this.exportFacade;
  }

  cancel(): void {
    this.workflow.cancel();
    this.exportFacade?.close();
    this.albums.relockAll();
    this.options.workflowChanged();
  }

  async drain(): Promise<void> {
    await Promise.all([this.exportFacade?.drain() ?? Promise.resolve(), this.mediaService?.close() ?? Promise.resolve()]);
  }

  close(): void {
    this.albums.close();
  }
}
