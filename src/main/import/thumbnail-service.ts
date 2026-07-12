import { Readable } from 'node:stream';

import type { BlobStore } from '../blobs/blob-store.js';
import type { EnvelopeKey } from '../crypto/envelope.js';
import type { ThumbnailDerivatives, ThumbnailPool } from './thumbnail-pool.js';

// Thumbnail generation service (#86): pool output → encrypted blob store.
// Derivatives stream through the same envelope path as originals (encrypt-
// then-move, no plaintext temp files); a photo whose bytes can't decode is
// recorded as a placeholder (generated: false), never a failed import.

export interface ThumbnailOutcome {
  /** False = placeholder (undecodable/unsupported bytes, E5.3 contract). */
  readonly generated: boolean;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ThumbnailRequest {
  readonly photoId: string;
  /** Original file bytes (the pool resolves RAF embedded previews itself). */
  readonly bytes: Buffer;
  /** Content hash of the ORIGINAL — derivatives are addressed under it. */
  readonly contentHash: string;
  readonly key: EnvelopeKey;
  readonly signal?: AbortSignal | undefined;
}

export class ThumbnailService {
  constructor(
    private readonly pool: ThumbnailPool,
    private readonly blobStore: BlobStore,
  ) {}

  /**
   * Generates and stores both ADR-0006 derivatives for one photo. Returns
   * the outcome (feeds the import dialog's per-file bar via #87's progress
   * events); throws only on infrastructure failures (store IO, worker
   * crash), which the import engine surfaces as retryable.
   */
  async generateFor(request: ThumbnailRequest): Promise<ThumbnailOutcome> {
    const derivatives = await this.pool.generate(request.bytes, request.signal);
    if (derivatives === null) {
      return { generated: false, width: null, height: null };
    }
    await this.store(request, derivatives);
    return { generated: true, width: derivatives.width, height: derivatives.height };
  }

  private async store(request: ThumbnailRequest, derivatives: ThumbnailDerivatives): Promise<void> {
    await this.blobStore.putThumb(Readable.from([derivatives.thumb]), request.key, request.photoId, request.contentHash, 'thumb');
    await this.blobStore.putThumb(Readable.from([derivatives.mid]), request.key, request.photoId, request.contentHash, 'mid');
  }
}
