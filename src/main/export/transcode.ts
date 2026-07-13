import sharp from 'sharp';

import { embeddedJpegFromRaf } from '../import/raf-preview.js';
import type { FileKind } from '../../shared/library/types.js';

// JPEG transcode for export (#98): "Format: JPEG" must open anywhere,
// including from RAW sources — which transcode from their embedded preview
// (ADR-0006 v1 policy), resolution honestly capped at preview size.
// Metadata is STRIPPED on transcode (sharp's default, kept deliberately):
// per ADR-0006's GPS stance, location and camera identity travel only when
// the user exports ORIGINALS. Orientation is baked in before the tag drops.

/** Recorded quality setting (#98). */
export const EXPORT_JPEG_QUALITY = 90;

export interface TranscodeResult {
  readonly jpeg: Buffer;
  /** True when the source was a RAW container's embedded preview. */
  readonly fromPreview: boolean;
}

export async function transcodeToJpeg(bytes: Buffer, fileKind: FileKind): Promise<TranscodeResult> {
  let source = bytes;
  let fromPreview = false;
  if (fileKind === 'raw') {
    // Every accepted RAW kind routes through the embedded-preview policy
    // (PR #195 review). v1 extracts RAF's documented preview; other RAW
    // containers have no v1 renderer — fail the entry honestly instead of
    // handing container bytes to sharp.
    const preview = embeddedJpegFromRaf(bytes);
    if (preview === null) {
      throw new Error('RAW has no extractable preview (v1 renders RAF previews only) — export as Original instead');
    }
    source = preview;
    fromPreview = true;
  }
  const jpeg = await sharp(source, { failOn: 'error' }).rotate().jpeg({ quality: EXPORT_JPEG_QUALITY }).toBuffer();
  return { jpeg, fromPreview };
}
