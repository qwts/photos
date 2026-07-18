import { decodeHeicWithNative, type NativeHeicResult } from './heic-preview-native.js';
import type { PreviewFailureReason } from '../../shared/library/preview.js';

export interface HeicPreview {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

export type HeicPreviewResult =
  { readonly ok: true; readonly preview: HeicPreview } | { readonly ok: false; readonly reason: PreviewFailureReason };

export type HeicDecoder = (bytes: Buffer, signal: AbortSignal | undefined) => Promise<NativeHeicResult | null>;

export interface HeicPreviewOptions {
  readonly signal?: AbortSignal | undefined;
  readonly decode?: HeicDecoder | undefined;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function validPreview(preview: HeicPreview): boolean {
  return (
    Buffer.isBuffer(preview.bytes) &&
    preview.bytes.length > 0 &&
    Number.isSafeInteger(preview.width) &&
    Number.isSafeInteger(preview.height) &&
    preview.width > 0 &&
    preview.height > 0
  );
}

/** Resolves one owned browser-viewable HEIC display payload. The encrypted,
 * byte-faithful original remains the authority; callers own and must wipe a
 * successful result. */
export async function resolveHeicPreview(bytes: Buffer, options: HeicPreviewOptions = {}): Promise<HeicPreviewResult | null> {
  if (isAborted(options.signal)) return null;
  const result = await (options.decode ?? decodeHeicWithNative)(bytes, options.signal);
  if (result === null || !result.ok) return result;
  if (isAborted(options.signal)) {
    result.preview.bytes.fill(0);
    return null;
  }
  if (!validPreview(result.preview)) {
    result.preview.bytes.fill(0);
    return { ok: false, reason: 'decode-failed' };
  }
  return result;
}
