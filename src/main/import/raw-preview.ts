import sharp from 'sharp';

import { embeddedJpegFromRaf, looksLikeJpeg } from './raf-preview.js';

export interface RawPreview {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly source: 'embedded' | 'decoded';
}

/** Shared RAW-preview seam. The first scaffold preserves RAF behavior; #368
 * expands this to every accepted RAW container and the native decode fallback. */
export async function resolveRawPreview(bytes: Buffer): Promise<RawPreview | null> {
  const candidate = embeddedJpegFromRaf(bytes) ?? (looksLikeJpeg(bytes) ? bytes : null);
  if (candidate === null) return null;
  try {
    const metadata = await sharp(candidate, { failOn: 'error' }).metadata();
    if (metadata.width === undefined || metadata.height === undefined) return null;
    return { bytes: Buffer.from(candidate), width: metadata.width, height: metadata.height, source: 'embedded' };
  } catch {
    return null;
  }
}
