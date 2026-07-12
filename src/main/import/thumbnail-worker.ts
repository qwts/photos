import { parentPort } from 'node:worker_threads';

import sharp from 'sharp';

// Thumbnail worker (#86): decode → resize → WebP per ADR-0006, off the main
// thread. Derivatives are sRGB and metadata-free — a thumbnail must never
// leak the GPS track the original carries. Encryption happens back in main
// (BlobStore.putThumb encrypts before anything touches disk).

export interface ThumbJobRequest {
  readonly jobId: number;
  /** Decodable image bytes (RAW callers extract the embedded preview first). */
  readonly bytes: Uint8Array;
}

export interface ThumbJobResponse {
  readonly jobId: number;
  readonly ok: boolean;
  readonly thumb?: Uint8Array;
  readonly mid?: Uint8Array;
  readonly width?: number;
  readonly height?: number;
  readonly error?: string;
}

// ADR-0006 derivative spec.
const THUMB_EDGE = 512;
const THUMB_QUALITY = 80;
const MID_EDGE = 2048;
const MID_QUALITY = 85;

async function derivative(bytes: Uint8Array, edge: number, quality: number): Promise<Buffer> {
  // sharp strips metadata and resolves to sRGB by default (no withMetadata /
  // withIccProfile) — exactly the ADR's privacy stance; rotate() bakes the
  // EXIF orientation in before the tag is dropped.
  return sharp(bytes, { failOn: 'error' })
    .rotate()
    .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

async function makeDerivatives(bytes: Uint8Array): Promise<Omit<ThumbJobResponse, 'jobId' | 'ok' | 'error'>> {
  const meta = await sharp(bytes, { failOn: 'error' }).metadata();
  const thumb = await derivative(bytes, THUMB_EDGE, THUMB_QUALITY);
  const mid = await derivative(bytes, MID_EDGE, MID_QUALITY);
  return { thumb, mid, width: meta.width, height: meta.height };
}

parentPort?.on('message', (request: ThumbJobRequest) => {
  void makeDerivatives(request.bytes)
    .then((result) => {
      parentPort?.postMessage({ jobId: request.jobId, ok: true, ...result } satisfies ThumbJobResponse);
    })
    .catch((error: unknown) => {
      // Undecodable/unsupported bytes are an EXPECTED outcome (placeholder
      // contract, E5.3) — reported as ok:false, never a worker death.
      parentPort?.postMessage({
        jobId: request.jobId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ThumbJobResponse);
    });
});
