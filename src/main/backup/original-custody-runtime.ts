import type { BlobStore } from '../blobs/blob-store.js';
import type { KeyResolver } from '../crypto/envelope.js';
import type { PhotosRepository } from '../db/photos-repository.js';
import { createEphemeralRuntime } from './ephemeral-runtime.js';
import type { EphemeralStage } from './ephemeral-originals.js';
import { OffloadService } from './offload.js';
import type { StorageProvider } from './provider.js';
import type { SyncLedger } from './sync-ledger.js';
import type { SyncStatus } from '../../shared/library/types.js';

export interface OriginalCustodyRuntimeOptions {
  readonly provider: StorageProvider;
  readonly connected: () => boolean;
  readonly ledger: SyncLedger;
  readonly repo: PhotosRepository;
  readonly blobs: BlobStore;
  readonly blobsReady: Promise<void>;
  readonly resolveKey: KeyResolver;
  readonly reOffloadAfterViewing: () => boolean;
  readonly workChanged: (delta: 1 | -1) => void;
  readonly syncStateChanged: (updates: readonly { readonly id: string; readonly syncState: SyncStatus }[]) => void;
  readonly storageChanged: () => void;
  readonly stateChanged: (state: { readonly photoId: string; readonly stage: EphemeralStage }) => void;
  readonly audit: (line: string) => void;
}

export function createOriginalCustodyRuntime(options: OriginalCustodyRuntimeOptions) {
  const offload = new OffloadService({
    provider: options.provider,
    providerConnected: options.connected,
    ledger: options.ledger,
    repo: {
      get: (id) => options.repo.get(id),
      countByContentHash: (hash) => options.repo.countByContentHash(hash),
      offloadedIds: () => options.repo.offloadedPhotoIds(),
    },
    ledgerDirty: (photoId) => options.ledger.isDirty(photoId),
    blobs: {
      deleteOriginal: (hash) => options.blobs.deleteOriginal(hash),
      hasOriginal: (hash) => options.blobs.hasOriginal(hash),
      encryptedStream: (hash) => options.blobs.getEncryptedStream(hash),
      restoreOriginal: (hash, ciphertext, photoId) => options.blobs.restoreOriginal(hash, ciphertext, options.resolveKey, photoId),
    },
    syncStateChanged: options.syncStateChanged,
    storageChanged: options.storageChanged,
    audit: options.audit,
  });
  const ephemeral = createEphemeralRuntime({
    provider: options.provider,
    providerConnected: options.connected,
    ledger: options.ledger,
    repo: options.repo,
    blobs: options.blobs,
    blobsReady: options.blobsReady,
    resolveKey: options.resolveKey,
    reOffloadAfterViewing: options.reOffloadAfterViewing,
    permanentRestore: (photoId) => offload.rehydrate(photoId),
    workChanged: options.workChanged,
    syncStateChanged: options.syncStateChanged,
    storageChanged: options.storageChanged,
    stateChanged: options.stateChanged,
    audit: options.audit,
  });
  return { offload, ephemeral };
}
