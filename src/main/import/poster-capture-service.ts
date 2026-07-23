import type { ThumbnailOutcome } from './thumbnail-service.js';
import type { PhotoRecord } from '../../shared/library/types.js';

// Deterministic video poster capture (ADR-0026 §6). Runs as post-import
// background work — one capture at a time, off the import hot path — so a video
// grid tile gains its first-decodable-frame poster without ever blocking import
// or moving the grid. A frame that can't be captured within budget leaves the
// kind-placeholder tile in place: a placeholder is a success state, never a
// failed import (§6). Capture never touches the stored original — the frame
// feeds the existing sharp derivative chain and the poster is regenerable cache.

export interface PosterCaptureSummary {
  readonly scanned: number;
  readonly captured: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface PosterCaptureServiceOptions {
  /** Video/animated candidates that may still need a poster. */
  readonly candidates: () => readonly PhotoRecord[];
  /** True when a valid poster derivative already exists (skip). */
  readonly hasPoster: (photo: PhotoRecord) => Promise<boolean>;
  /** Captures the first decodable frame as encoded image bytes, or null when no
   * frame decodes within the wall-clock/pixel budget (§9). Never throws for a
   * decode miss — that is a null, so the placeholder simply stays. */
  readonly captureFrame: (photo: PhotoRecord, signal: AbortSignal) => Promise<Buffer | null>;
  /** Feeds a captured frame to the sharp derivative chain and stores the poster. */
  readonly storePoster: (photo: PhotoRecord, frame: Buffer, signal: AbortSignal) => Promise<ThumbnailOutcome>;
  /** Notifies the renderer that these items gained a poster (grid refresh). */
  readonly changed: (photoIds: readonly string[]) => void;
  readonly yieldTurn?: (() => Promise<void>) | undefined;
}

const defaultYield = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** One cancellable, sequential capture pass. Sequential single-frame capture
 * keeps peak memory to one offscreen frame plus the thumbnail pool's outputs. */
export class PosterCaptureService {
  private readonly controller = new AbortController();

  constructor(private readonly options: PosterCaptureServiceOptions) {}

  close(): void {
    this.controller.abort();
  }

  async capture(): Promise<PosterCaptureSummary> {
    let scanned = 0;
    let captured = 0;
    let failed = 0;
    let skipped = 0;
    const changed: string[] = [];
    const yieldTurn = this.options.yieldTurn ?? defaultYield;

    for (const photo of this.options.candidates()) {
      if (this.controller.signal.aborted) break;
      scanned += 1;
      try {
        if (await this.options.hasPoster(photo)) {
          skipped += 1;
          continue;
        }
        const frame = await this.options.captureFrame(photo, this.controller.signal);
        if (frame === null) {
          // No decodable frame within budget — keep the placeholder tile.
          failed += 1;
          continue;
        }
        const outcome = await this.options.storePoster(photo, frame, this.controller.signal);
        if (outcome.generated) {
          captured += 1;
          changed.push(photo.id);
        } else {
          failed += 1;
        }
      } catch {
        // Background work must never surface: a capture fault leaves the
        // placeholder and the item is retried on the next pass.
        failed += 1;
      }
      await yieldTurn();
    }

    if (changed.length > 0) this.options.changed(changed);
    return { scanned, captured, failed, skipped };
  }
}
