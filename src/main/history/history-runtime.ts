import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import type { BlobStore } from '../blobs/blob-store.js';
import type { KeyResolver } from '../crypto/envelope.js';
import type { LibraryService } from '../library/library-service.js';
import { HistoryService } from './history-service.js';
import { createMoveCompensationRuntime } from './move-compensation-runtime.js';

export function createHistoryService(
  parts: { db: BetterSqlite3.Database; blobStore: BlobStore; keyStore: { resolver(): KeyResolver } },
  library: LibraryService,
  onManifestChanged: () => void,
  onBoardsChanged?: (boardId: string) => void,
): HistoryService {
  return new HistoryService(
    parts.db,
    library,
    createMoveCompensationRuntime(parts.blobStore, parts.keyStore.resolver()),
    onManifestChanged,
    onBoardsChanged,
  );
}
