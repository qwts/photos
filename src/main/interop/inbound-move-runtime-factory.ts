import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import type { BlobStore } from '../blobs/blob-store.js';
import type { EnvelopeKey, KeyResolver } from '../crypto/envelope.js';
import { PhotosRepository } from '../db/photos-repository.js';
import type { ThumbnailService } from '../import/thumbnail-service.js';
import { InboundMoveObjectJournal } from './inbound-move-object-journal.js';
import { InboundPhotoImporter } from './inbound-photo-importer.js';
import { InboundMoveRuntime } from './inbound-move-runtime.js';
import { InteropRepository } from './interop-repository.js';
import { MoveJournalRepository } from './move-journal-repository.js';
import type { InteropKeyCustody } from './pairing-custody.js';
import { InteropTranslationService } from './translation-service.js';
import type { InteropObjectStore } from './transport.js';

export interface InboundMoveRuntimeFactoryOptions {
  readonly db: BetterSqlite3.Database;
  readonly blobs: BlobStore;
  readonly blobsReady: Promise<void>;
  readonly currentKey: () => EnvelopeKey;
  readonly resolveKey: KeyResolver;
  readonly thumbnails: Pick<ThumbnailService, 'generateFor'>;
  readonly store: InteropObjectStore;
  readonly custody: () => InteropKeyCustody;
  readonly photoChanged: (photoId: string) => void;
  readonly beginWork: () => () => void;
}

export function createInboundMoveRuntime(options: InboundMoveRuntimeFactoryOptions): InboundMoveRuntime {
  const photos = new PhotosRepository(options.db);
  const interop = new InteropRepository(options.db);
  const importer = new InboundPhotoImporter({
    db: options.db,
    photos,
    interop,
    blobs: {
      putOriginal: async (plaintext, key, photoId) => {
        await options.blobsReady;
        return options.blobs.putOriginal(plaintext, key, photoId);
      },
      verifyOriginal: (contentHash, resolveKey, photoId) => options.blobs.verifyOriginal(contentHash, resolveKey, photoId),
    },
    currentKey: options.currentKey,
    resolveKey: options.resolveKey,
    thumbnails: options.thumbnails,
  });
  return new InboundMoveRuntime({
    store: options.store,
    custody: options.custody,
    translation: new InteropTranslationService(interop, photos),
    importer,
    journals: new MoveJournalRepository(options.db),
    objects: new InboundMoveObjectJournal(options.db),
    onPhotoChanged: options.photoChanged,
    beginWork: options.beginWork,
  });
}
