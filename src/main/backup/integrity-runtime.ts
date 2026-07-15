import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import type { BlobStore } from '../blobs/blob-store.js';
import type { KeyResolver } from '../crypto/envelope.js';
import type { PhotosRepository } from '../db/photos-repository.js';
import { BackupIntegrityCursorStore } from './integrity-cursor.js';
import { BackupIntegrityScrubber, verifyRemoteOriginalCiphertext } from './integrity-scrubber.js';
import type { StorageProvider } from './provider.js';

interface BackupIntegrityRuntimeDeps {
  readonly db: BetterSqlite3.Database;
  readonly provider: StorageProvider;
  readonly repo: Pick<PhotosRepository, 'integrityItems'>;
  readonly blobs: Pick<BlobStore, 'hasOriginal' | 'getEncryptedStream'>;
  readonly resolveKey: KeyResolver;
  readonly markUnrecoverable: (photoId: string) => void;
  readonly audit: (line: string) => void;
}

/** Composition seam kept outside index.ts so the Electron root stays below
 * the repository's enforced file-size ceiling. */
export function createBackupIntegrityRuntime(deps: BackupIntegrityRuntimeDeps): BackupIntegrityScrubber {
  return new BackupIntegrityScrubber({
    provider: deps.provider,
    batchSize: 50,
    items: (page) => deps.repo.integrityItems(page),
    hasLocal: (hash) => deps.blobs.hasOriginal(hash),
    encryptedStream: (hash) => deps.blobs.getEncryptedStream(hash),
    verifyRemoteCiphertext: (item, ciphertext) => verifyRemoteOriginalCiphertext(item, ciphertext, deps.resolveKey),
    markUnrecoverable: deps.markUnrecoverable,
    cursor: new BackupIntegrityCursorStore(deps.db, () => deps.provider.id),
    audit: deps.audit,
    now: () => new Date(),
  });
}
