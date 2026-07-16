import type { StorageProvider } from './provider.js';
import { ProviderError } from './provider.js';
import { protectedObjectPath } from './protected-object-path.js';
import type { ProtectedBlobStore, ProtectedBlobKind } from '../blobs/protected-blob-store.js';
import type { ProtectedAlbumAuthorityRegistry } from '../crypto/protected-album-authority.js';
import type { ProtectedRecoveryRepository, ProtectedRemoteObject } from '../db/protected-recovery-repository.js';
import type { BackupIntegritySummary } from './integrity-scrubber.js';

export interface ProtectedBackupRunResult {
  readonly uploaded: number;
  readonly failed: number;
}

export interface ProtectedBackupServiceOptions {
  readonly provider: StorageProvider;
  readonly repository: ProtectedRecoveryRepository;
  readonly blobs: ProtectedBlobStore;
  readonly authorities: ProtectedAlbumAuthorityRegistry;
  readonly now: () => Date;
  readonly audit: (line: string) => void;
}

function isRemoteDamage(error: unknown): boolean {
  return error instanceof ProviderError && (error.kind === 'not-found' || error.kind === 'corrupt');
}

/** Ciphertext-only custody for the protected domain. Remote paths and logs
 * contain no album id, plaintext content hash, file name, or membership. */
export class ProtectedBackupService {
  constructor(private readonly options: ProtectedBackupServiceOptions) {}

  async run(signal?: AbortSignal): Promise<ProtectedBackupRunResult> {
    let uploaded = 0;
    let failed = 0;
    for (const object of this.options.repository.dirtyObjects()) {
      if (signal?.aborted === true) break;
      try {
        const path = protectedObjectPath(object.blobRef, object.kind);
        await this.options.provider.put(path, this.options.blobs.getEncryptedStream(object.albumId, object.blobRef, object.kind));
        const local = await this.options.blobs.ciphertextInfo(object.albumId, object.blobRef, object.kind);
        const remote = await this.options.provider.verify(path);
        if (remote.sha256 !== local.sha256 || remote.bytes !== local.bytes) {
          throw new ProviderError('protected ciphertext verification failed', 'corrupt');
        }
        this.options.repository.markBackedUp(object, local.sha256, local.bytes, this.options.now().toISOString());
        this.options.audit('PROTECTED-VERIFY-OK');
        uploaded += 1;
      } catch (error) {
        this.options.repository.markError(object);
        this.options.audit('PROTECTED-BACKUP-FAILED');
        failed += 1;
        if (error instanceof ProviderError && (error.kind === 'auth' || error.kind === 'quota')) break;
      }
    }
    return { uploaded, failed };
  }

  async scrub(): Promise<BackupIntegritySummary> {
    let repaired = 0;
    let unrecoverable = 0;
    const objects = this.options.repository.recoverableObjects();
    for (const object of objects) {
      const path = protectedObjectPath(object.blobRef, object.kind);
      const expected = this.expected(object);
      let damaged: boolean;
      try {
        const remote = await this.options.provider.verify(path);
        damaged = remote.sha256 !== expected.sha256 || remote.bytes !== expected.bytes;
      } catch (error) {
        if (!isRemoteDamage(error)) throw error;
        damaged = true;
      }
      if (!damaged) continue;
      if (this.options.blobs.has(object.albumId, object.blobRef, object.kind)) {
        await this.options.provider.put(path, this.options.blobs.getEncryptedStream(object.albumId, object.blobRef, object.kind));
        const verified = await this.options.provider.verify(path);
        if (verified.sha256 !== expected.sha256 || verified.bytes !== expected.bytes) {
          throw new ProviderError('protected integrity repair verification failed', 'corrupt');
        }
        repaired += 1;
        this.options.audit('PROTECTED-INTEGRITY-REPAIRED');
      } else {
        this.options.repository.markError(object);
        unrecoverable += 1;
        this.options.audit('PROTECTED-INTEGRITY-UNRECOVERABLE');
      }
    }
    return { checked: objects.length, repaired, unrecoverable, cycleComplete: true };
  }

  /** Deletes local ciphertext only after every remote object was verified
   * during this authorized operation. */
  async offload(albumId: string, photoId: string): Promise<void> {
    const authority = this.options.authorities.snapshot(albumId);
    const objects = this.photoObjects(albumId, photoId);
    for (const object of objects) {
      const expected = this.expected(object);
      const remote = await this.options.provider.verify(protectedObjectPath(object.blobRef, object.kind));
      if (remote.sha256 !== expected.sha256 || remote.bytes !== expected.bytes) {
        throw new ProviderError('protected offload verification failed', 'corrupt');
      }
    }
    if (!this.options.authorities.isCurrent(authority)) throw new Error('protected album is locked');
    for (const object of objects) await this.options.blobs.deleteKind(albumId, object.blobRef, object.kind);
    if (!this.options.authorities.isCurrent(authority)) throw new Error('protected album is locked');
    this.options.repository.markOffloaded(photoId);
  }

  /** Rehydrates authenticated ciphertext while authority remains live. */
  async rehydrate(albumId: string, photoId: string): Promise<void> {
    const authority = this.options.authorities.snapshot(albumId);
    const objects = this.photoObjects(albumId, photoId);
    const restored: ProtectedBlobKind[] = [];
    try {
      for (const object of objects) {
        const expected = this.expected(object);
        await this.options.blobs.restoreEncrypted({
          albumId,
          blobRef: object.blobRef,
          kind: object.kind,
          ciphertext: await this.options.provider.getStream(protectedObjectPath(object.blobRef, object.kind)),
          ...expected,
        });
        restored.push(object.kind);
        if (!this.options.authorities.isCurrent(authority)) throw new Error('protected album is locked');
      }
      this.options.repository.markRehydrated(photoId);
    } catch (error) {
      for (const kind of restored) await this.options.blobs.deleteKind(albumId, objects[0]?.blobRef ?? '', kind);
      throw error;
    }
  }

  private photoObjects(albumId: string, photoId: string): readonly ProtectedRemoteObject[] {
    const objects = this.options.repository.objects(photoId);
    if (objects.length === 0 || objects.some((object) => object.albumId !== albumId)) throw new Error('protected content is unavailable');
    return objects;
  }

  private expected(object: ProtectedRemoteObject): { readonly sha256: string; readonly bytes: number } {
    if (object.sha256 === null || object.bytes === null || object.dirty) throw new Error('protected remote object is not verified');
    return { sha256: object.sha256, bytes: object.bytes };
  }
}
