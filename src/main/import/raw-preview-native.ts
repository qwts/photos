import { createRequire } from 'node:module';

interface NativeRawPreview {
  readonly decode: (bytes: Buffer, maxEdge: number) => Promise<Buffer>;
}

const nativeRequire = createRequire(import.meta.url);
let loaded: NativeRawPreview | null | undefined;

function bridge(): NativeRawPreview | null {
  if (loaded !== undefined) return loaded;
  if (process.platform !== 'darwin') {
    loaded = null;
    return loaded;
  }
  try {
    loaded = nativeRequire('@overlook/touch-id/raw.cjs') as NativeRawPreview;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Core Image RAW decode, in memory. A missing bridge or unsupported camera is
 * an ordinary null result so the caller can surface PREVIEW UNAVAILABLE. */
export async function decodeRawWithNative(bytes: Buffer, signal: AbortSignal | undefined): Promise<Buffer | null> {
  if (signal?.aborted) return null;
  const native = bridge();
  if (native === null) return null;
  try {
    const decoded = await native.decode(bytes, 4096);
    if (signal?.aborted) {
      decoded.fill(0);
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
