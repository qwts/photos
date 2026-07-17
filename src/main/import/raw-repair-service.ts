import type { ExtractedMetadata } from './exif.js';
import type { ThumbnailOutcome } from './thumbnail-service.js';
import type { PhotoRecord } from '../../shared/library/types.js';

export interface RawRepairSummary {
  readonly scanned: number;
  readonly repaired: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface RawRepairServiceOptions {
  readonly candidates: () => readonly PhotoRecord[];
  readonly validThumbs: (photo: PhotoRecord) => Promise<boolean>;
  readonly loadOriginal: (photo: PhotoRecord) => Promise<Buffer | null>;
  readonly extractMetadata: (bytes: Buffer) => Promise<ExtractedMetadata>;
  readonly regenerate: (photo: PhotoRecord, bytes: Buffer, signal: AbortSignal) => Promise<ThumbnailOutcome>;
  readonly repairMetadata: (photoId: string, metadata: ExtractedMetadata) => boolean;
  readonly changed: (photoIds: readonly string[]) => void;
  readonly yieldTurn?: (() => Promise<void>) | undefined;
}

const yieldTurn = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** One cancellable, sequential startup pass. Sequential RAW decode keeps peak
 * plaintext bounded to one original plus the thumbnail pool's two outputs. */
export class RawRepairService {
  private readonly controller = new AbortController();

  constructor(private readonly options: RawRepairServiceOptions) {}

  close(): void {
    this.controller.abort();
  }

  async repair(): Promise<RawRepairSummary> {
    let scanned = 0;
    let repaired = 0;
    let failed = 0;
    let skipped = 0;
    const changed: string[] = [];
    for (const photo of this.options.candidates()) {
      if (this.controller.signal.aborted) break;
      scanned += 1;
      let bytes: Buffer | null = null;
      try {
        const thumbsReady = await this.options.validThumbs(photo);
        if (thumbsReady && photo.width > 0 && photo.height > 0) {
          skipped += 1;
          continue;
        }
        bytes = await this.options.loadOriginal(photo);
        if (bytes === null) {
          skipped += 1;
          continue;
        }
        const metadata = await this.options.extractMetadata(bytes);
        if (this.controller.signal.aborted) break;
        let outcome: ThumbnailOutcome | null = null;
        if (!thumbsReady) {
          outcome = await this.options.regenerate(photo, bytes, this.controller.signal);
        }
        if (this.controller.signal.aborted) break;
        const repairedMetadata = this.options.repairMetadata(photo.id, {
          ...metadata,
          width: metadata.width ?? outcome?.width ?? null,
          height: metadata.height ?? outcome?.height ?? null,
        });
        const repairedThumbs = !thumbsReady && outcome?.generated === true;
        if (repairedMetadata || repairedThumbs) {
          repaired += 1;
          changed.push(photo.id);
        }
        if (!thumbsReady && outcome?.generated !== true) failed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[overlook] RAW preview repair failed for ${photo.id}`, error);
      } finally {
        bytes?.fill(0);
      }
      await (this.options.yieldTurn ?? yieldTurn)();
    }
    if (changed.length > 0) this.options.changed(changed);
    return { scanned, repaired, failed, skipped };
  }
}
