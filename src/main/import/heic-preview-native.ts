import { createRequire } from 'node:module';

import type { PreviewFailureReason } from '../../shared/library/preview.js';

export interface NativeHeicPreview {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

interface NativeHeicBridge {
  readonly decodeHeic: (bytes: Buffer, maxEdge: number) => Promise<NativeHeicPreview>;
}

export type NativeHeicResult =
  { readonly ok: true; readonly preview: NativeHeicPreview } | { readonly ok: false; readonly reason: PreviewFailureReason };

export interface NativeHeicOptions {
  readonly platform?: NodeJS.Platform | undefined;
  readonly loadBinding?: (() => NativeHeicBridge) | undefined;
}

const nativeRequire = createRequire(import.meta.url);
const MAX_EDGE = 4096;

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function failureReason(error: unknown): PreviewFailureReason {
  const code = error instanceof Error && 'code' in error ? String(error.code) : '';
  if (code === 'HEIC_CORRUPT') return 'corrupt';
  if (code === 'HEIC_UNSUPPORTED_CODEC') return 'unsupported-codec';
  return 'decode-failed';
}

/** ImageIO HEIC decode, in memory. Cancellation is cooperative around the
 * bounded native job; discarded owned output is always zeroized. */
export async function decodeHeicWithNative(
  bytes: Buffer,
  signal: AbortSignal | undefined,
  options: NativeHeicOptions = {},
): Promise<NativeHeicResult | null> {
  if (isAborted(signal)) return null;
  if ((options.platform ?? process.platform) !== 'darwin') return { ok: false, reason: 'unsupported-codec' };
  let bridge: NativeHeicBridge;
  try {
    bridge = (options.loadBinding ?? (() => nativeRequire('@overlook/touch-id/raw.cjs') as NativeHeicBridge))();
  } catch {
    return { ok: false, reason: 'unsupported-codec' };
  }
  if (typeof bridge.decodeHeic !== 'function') return { ok: false, reason: 'unsupported-codec' };
  try {
    const preview = await bridge.decodeHeic(bytes, MAX_EDGE);
    if (isAborted(signal)) {
      preview.bytes.fill(0);
      return null;
    }
    return { ok: true, preview };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
}
