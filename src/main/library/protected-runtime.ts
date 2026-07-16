import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { ProtectedBlobStore } from '../blobs/protected-blob-store.js';
import type { BlobStore } from '../blobs/blob-store.js';
import { ProtectedBackupService } from '../backup/protected-backup-service.js';
import type { StorageProvider } from '../backup/provider.js';
import { ProtectedAlbumAuthorityRegistry } from '../crypto/protected-album-authority.js';
import { ProtectedAlbumService } from '../crypto/protected-album-service.js';
import { ProtectedPhotoMigrationService } from '../crypto/protected-photo-migration-service.js';
import { ProtectedAlbumRepository } from '../db/protected-album-repository.js';
import { ProtectedPhotoMigrationRepository } from '../db/protected-photo-migration-repository.js';
import { ProtectedRecoveryRepository } from '../db/protected-recovery-repository.js';
import { PhotosRepository } from '../db/photos-repository.js';
import { createProtectedExportRuntime, type DrainableProtectedExportFacade } from '../export/protected-export-runtime.js';
import { ProtectedLibraryService } from './protected-library-service.js';
import { ProtectedMediaService } from './protected-media-service.js';

export interface ProtectedRuntimeOptions {
  readonly dataDir: string;
  readonly db: BetterSqlite3.Database;
  readonly libraryId: string;
  readonly ordinaryBlobs: BlobStore;
  readonly oweManifest: () => void;
  readonly revokeOrdinary: (photoIds: readonly string[]) => void;
  readonly progress: (done: number, total: number) => void;
  readonly pickDestination: () => Promise<string | null>;
  readonly failure: () => void;
  readonly repairFailure: () => void;
}

/** Owns the independently authorized protected domain and every decrypted
 * cache/export generation derived from it. */
export class ProtectedRuntime {
  readonly albums: ProtectedAlbumService;
  readonly library: ProtectedLibraryService;
  readonly migrations: ProtectedPhotoMigrationService;
  readonly recovery: ProtectedRecoveryRepository;
  private readonly authorities = new ProtectedAlbumAuthorityRegistry();
  private readonly blobs: ProtectedBlobStore;
  private mediaService: ProtectedMediaService | undefined;
  private exportFacade: DrainableProtectedExportFacade | undefined;

  constructor(private readonly options: ProtectedRuntimeOptions) {
    this.blobs = new ProtectedBlobStore(options.dataDir);
    const blobsReady = this.blobs.init();
    const photos = new ProtectedPhotoMigrationRepository(options.db);
    this.recovery = new ProtectedRecoveryRepository(options.db);
    this.albums = new ProtectedAlbumService({
      libraryId: options.libraryId,
      repository: new ProtectedAlbumRepository(options.db, options.libraryId),
      authorities: this.authorities,
    });
    this.library = new ProtectedLibraryService({
      libraryId: options.libraryId,
      albums: new ProtectedAlbumRepository(options.db, options.libraryId),
      photos,
      blobs: this.blobs,
      blobsReady,
      authorities: this.authorities,
    });
    this.migrations = new ProtectedPhotoMigrationService({
      libraryId: options.libraryId,
      ordinaryBlobs: options.ordinaryBlobs,
      protectedBlobs: this.blobs,
      photos: new PhotosRepository(options.db),
      migrations: photos,
      oweManifest: options.oweManifest,
      revokeOrdinary: options.revokeOrdinary,
    });
    void blobsReady.then(() => this.migrations.repairStartup()).catch(options.repairFailure);
  }

  backup(provider: StorageProvider, audit: (line: string) => void): ProtectedBackupService {
    return new ProtectedBackupService({
      provider,
      repository: this.recovery,
      blobs: this.blobs,
      authorities: this.authorities,
      now: () => new Date(),
      audit,
    });
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
    this.exportFacade?.close();
    this.albums.relockAll();
  }

  async drain(): Promise<void> {
    await Promise.all([this.exportFacade?.drain() ?? Promise.resolve(), this.mediaService?.close() ?? Promise.resolve()]);
  }

  close(): void {
    this.albums.close();
  }
}
