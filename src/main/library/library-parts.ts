import type { BlobStore } from '../blobs/blob-store.js';
import type { KeyStore } from '../crypto/keystore.js';
import type { openLibraryDatabase } from '../db/database.js';
import type { ProtectedRuntime } from './protected-runtime.js';

export interface LibraryParts {
  readonly db: ReturnType<typeof openLibraryDatabase>;
  readonly blobStore: BlobStore;
  readonly blobStoreReady: Promise<void>;
  readonly keyStore: KeyStore;
  readonly protected: ProtectedRuntime;
}
