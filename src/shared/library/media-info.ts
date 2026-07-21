import { z } from 'zod';

// Probed media facts per ADR-0026 §1: container/stream properties recorded at
// import from validated signatures — never fabricated, never normalized into
// the original. #547 carries the animated-image fields; video/audio facts
// (#549/#548) extend this record, not the FileKind enum. Playability is NOT
// here by design (ADR-0026 §3): it is derived per device at runtime.

export const mediaInfoSchema = z
  .object({
    /** True when the container carries more than one displayable frame. */
    animated: z.boolean(),
    /** Frames counted by the bounded probe; null when the budget cut it short. */
    frameCount: z.number().int().positive().nullable(),
    /** Declared loop count; 0 = loop forever; null = container states none. */
    loopCount: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type MediaInfo = z.output<typeof mediaInfoSchema>;

/** Parses a stored media_info JSON column value; null for anything invalid —
 * a corrupt row degrades to "no probed facts", never a crash. */
export function parseMediaInfo(value: string | null): MediaInfo | null {
  if (value === null) return null;
  try {
    return mediaInfoSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}
