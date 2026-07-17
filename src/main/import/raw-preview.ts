import sharp from 'sharp';
import type { Metadata } from 'sharp';

import { decodeRawWithNative } from './raw-preview-native.js';
import { embeddedJpegFromRaf, looksLikeJpeg } from './raf-preview.js';

export interface RawPreview {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly source: 'embedded' | 'decoded';
}

export type RawDecoder = (bytes: Buffer, signal: AbortSignal | undefined) => Promise<Buffer | null>;

export interface RawPreviewOptions {
  readonly signal?: AbortSignal | undefined;
  /** Test seam; production uses the in-memory Core Image bridge on macOS. */
  readonly decode?: RawDecoder | undefined;
}

const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);
const MAX_CANDIDATES = 32;
const MAX_PREVIEW_BYTES = 128 * 1024 * 1024;

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function displayDimensions(metadata: Metadata): { readonly width: number; readonly height: number } | null {
  if (metadata.width === undefined || metadata.height === undefined || metadata.width <= 0 || metadata.height <= 0) return null;
  return metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

async function inspect(candidate: Buffer): Promise<{ readonly width: number; readonly height: number } | null> {
  try {
    const metadata = await sharp(candidate, { failOn: 'error' }).metadata();
    return displayDimensions(metadata);
  } catch {
    return null;
  }
}

function embeddedCandidates(bytes: Buffer): Buffer[] {
  const candidates: Buffer[] = [];
  const raf = embeddedJpegFromRaf(bytes);
  if (raf !== null) candidates.push(raf);
  if (looksLikeJpeg(bytes)) candidates.push(bytes);

  let cursor = 0;
  while (candidates.length < MAX_CANDIDATES) {
    const start = bytes.indexOf(JPEG_START, cursor);
    if (start < 0) break;
    const end = bytes.indexOf(JPEG_END, start + JPEG_START.length);
    cursor = start + JPEG_START.length;
    if (end < 0) continue;
    const length = end + JPEG_END.length - start;
    if (length <= MAX_PREVIEW_BYTES) candidates.push(bytes.subarray(start, end + JPEG_END.length));
  }
  return candidates;
}

async function bestEmbedded(bytes: Buffer, signal: AbortSignal | undefined): Promise<RawPreview | null> {
  let best: RawPreview | null = null;
  const seen = new Set<string>();
  for (const candidate of embeddedCandidates(bytes)) {
    if (isAborted(signal)) {
      best?.bytes.fill(0);
      return null;
    }
    const identity = `${String(candidate.byteOffset)}:${String(candidate.byteLength)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const dimensions = await inspect(candidate);
    if (isAborted(signal)) {
      best?.bytes.fill(0);
      return null;
    }
    if (dimensions === null) continue;
    const area = dimensions.width * dimensions.height;
    const bestArea = best === null ? -1 : best.width * best.height;
    if (area > bestArea || (area === bestArea && candidate.length > (best?.bytes.length ?? 0))) {
      best?.bytes.fill(0);
      best = { bytes: Buffer.from(candidate), ...dimensions, source: 'embedded' };
    }
  }
  return best;
}

/**
 * Resolves one owned, viewable RAW payload without writing plaintext to disk.
 * Trustworthy embedded JPEGs win; preview-less containers fall back to the
 * bounded native decoder. Cancellation is checked before and after both
 * expensive stages, and every discarded owned buffer is zeroized.
 */
export async function resolveRawPreview(bytes: Buffer, options: RawPreviewOptions = {}): Promise<RawPreview | null> {
  if (isAborted(options.signal)) return null;
  const embedded = await bestEmbedded(bytes, options.signal);
  if (isAborted(options.signal)) {
    embedded?.bytes.fill(0);
    return null;
  }
  if (embedded !== null) return embedded;

  const decoded = await (options.decode ?? decodeRawWithNative)(bytes, options.signal);
  if (decoded === null) return null;
  const owned = Buffer.from(decoded);
  decoded.fill(0);
  const dimensions = await inspect(owned);
  if (dimensions === null || isAborted(options.signal)) {
    owned.fill(0);
    return null;
  }
  return { bytes: owned, ...dimensions, source: 'decoded' };
}
