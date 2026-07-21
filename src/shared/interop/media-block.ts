import { z } from 'zod';

import { mediaInfoSchema } from '../library/media-info.js';
import type { InteropJsonObject } from './json.js';

// ADR-0026 §8: media facts cross the Image Trail boundary inside contract
// v1's open product-specific object — `roundTripMetadata.overlook.media` —
// because the strict v1 record schema rejects unknown top-level keys. Peers
// that predate the block preserve roundTripMetadata verbatim by existing
// contract, so it round-trips losslessly; absence means still image.
// Playability tiers deliberately never appear here (ADR-0026 §3).

export const INTEROP_MEDIA_BLOCK_KEY = 'media';

export const interopMediaBlockSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Media kinds with probed facts; stills stay blockless. */
    kind: z.enum(['gif', 'webp', 'video', 'audio']),
    /** Original MIME, preserved verbatim — MIME drift is contract breakage. */
    mimeType: z.string().min(1),
    /** Original lowercase filename extension without the dot, if any. */
    extension: z.string().min(1).nullable(),
    mediaInfo: mediaInfoSchema.nullable(),
  })
  .strict();

export type InteropMediaBlock = z.output<typeof interopMediaBlockSchema>;

/** Reads the media block out of a record's `roundTripMetadata.overlook`;
 * null when absent or invalid (never a throw — foreign metadata is data). */
export function mediaBlockFrom(overlook: InteropJsonObject): InteropMediaBlock | null {
  const parsed = interopMediaBlockSchema.safeParse(overlook[INTEROP_MEDIA_BLOCK_KEY]);
  return parsed.success ? parsed.data : null;
}

/** Returns a copy of `overlook` carrying the media block (or stripped of it
 * when `block` is null); other product round-trip keys are preserved. */
export function withMediaBlock(overlook: InteropJsonObject, block: InteropMediaBlock | null): InteropJsonObject {
  const { [INTEROP_MEDIA_BLOCK_KEY]: _existing, ...rest } = overlook;
  if (block === null) return rest;
  return { ...rest, [INTEROP_MEDIA_BLOCK_KEY]: interopMediaBlockSchema.parse(block) };
}
