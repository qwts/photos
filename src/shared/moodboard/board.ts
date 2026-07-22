import { z } from 'zod';

// Moodboard domain (#515 / #693). A board is album-class organizational
// metadata: a named canvas holding ordered *placements*, each a reference to a
// photo plus its display transform (position, size, rotation, crop frame,
// layer). It stores no pixels and mutates no original — every operation here is
// pure and returns new objects, so the same photo can appear on many boards and
// many times on one board without any placement affecting another (invariant
// I3). Serialization is canonical/byte-stable so a board reloads identically
// across restart, library switch, backup/restore, and window resize (I2).

/** A visible crop window over the full image, as fractions of the source in
 * [0,1]. The default full frame `{0,0,1,1}` shows the whole image. The original
 * is never trimmed — this is a non-destructive display window. */
export interface CropFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One placement of a photo on a board. `id` is the placement's own identity
 * (many placements may share a `photoId`). Coordinates are absolute board-space
 * pixels, resolution-independent of the viewport. */
export interface Placement {
  readonly id: string;
  readonly photoId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Degrees clockwise, normalized to [0, 360). */
  readonly rotation: number;
  readonly crop: CropFrame;
  /** Layer order; unique and contiguous 1..N across a board's placements. */
  readonly z: number;
  /** Grouping key; placements sharing a non-null id move/align as one unit. */
  readonly groupId: string | null;
}

export interface BoardSize {
  readonly width: number;
  readonly height: number;
}

/** Background tone keys — resolved to tokens in the renderer, never raw color
 * here (machine data, no magic values in the UI). */
export type BoardBackground = 'ink' | 'paper' | 'sepia' | 'navy';

export interface Board {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly size: BoardSize;
  readonly background: BoardBackground;
  readonly placements: readonly Placement[];
}

export const BOARD_ZOOM_MIN = 0.25;
export const BOARD_ZOOM_MAX = 4;
export const BOARD_ZOOM_STEP = 0.25;
/** Smallest placement edge in board-space pixels; resize clamps to this. */
export const MIN_PLACEMENT_SIZE = 40;
/** Rotation snap increment (degrees) when snapping is requested. */
export const ROTATION_SNAP = 15;
/** Rotation detents that read as "square" for guide feedback. */
export const ROTATION_DETENTS: readonly number[] = [0, 90, 180, 270];

export const DEFAULT_BOARD_SIZE: BoardSize = { width: 1600, height: 1200 };
export const DEFAULT_BACKGROUND: BoardBackground = 'ink';

export const BOARD_BACKGROUNDS: readonly BoardBackground[] = ['ink', 'paper', 'sepia', 'navy'];

/** Declared board-size presets offered in the settings panel. */
export const BOARD_SIZE_PRESETS: readonly { readonly label: string; readonly size: BoardSize }[] = [
  { label: '4:3', size: { width: 1600, height: 1200 } },
  { label: '16:9', size: { width: 1920, height: 1080 } },
  { label: '1:1', size: { width: 1600, height: 1600 } },
  { label: '3:4', size: { width: 1200, height: 1600 } },
];

// ---- validation ----------------------------------------------------------

const fractionSchema = z.number().min(0).max(1);

export const cropFrameSchema = z.object({
  x: fractionSchema,
  y: fractionSchema,
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

export const placementSchema = z.object({
  id: z.string().min(1),
  photoId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number().min(MIN_PLACEMENT_SIZE),
  h: z.number().min(MIN_PLACEMENT_SIZE),
  rotation: z.number(),
  crop: cropFrameSchema,
  z: z.number().int().positive(),
  groupId: z.string().min(1).nullable(),
});

export const boardSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const boardBackgroundSchema = z.enum(['ink', 'paper', 'sepia', 'navy']);

export const boardSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  notes: z.string(),
  size: boardSizeSchema,
  background: boardBackgroundSchema,
  // readonly so the schema's inferred board matches the hand-written Board
  // (readonly placements) across the IPC boundary in both directions.
  placements: z.array(placementSchema).readonly(),
});

// ---- normalization + canonical serialization (I2) ------------------------

export const FULL_CROP: CropFrame = { x: 0, y: 0, w: 1, h: 1 };

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // `+ 0` collapses -0 to 0 so serialization is stable across equivalent inputs.
  return Math.round(value * factor) / factor + 0;
}

/** Normalize an angle to [0, 360) with 2-decimal precision. */
export function normalizeRotation(rotation: number): number {
  const wrapped = ((rotation % 360) + 360) % 360;
  return roundTo(wrapped, 2);
}

function normalizeCrop(crop: CropFrame): CropFrame {
  const x = clampFraction(crop.x);
  const y = clampFraction(crop.y);
  return {
    x,
    y,
    w: roundTo(Math.min(Math.max(crop.w, 0), 1 - x) || 1e-6, 6),
    h: roundTo(Math.min(Math.max(crop.h, 0), 1 - y) || 1e-6, 6),
  };
}

function clampFraction(value: number): number {
  return roundTo(Math.min(Math.max(value, 0), 1), 6);
}

/** Canonicalize a placement: integer board pixels, clamped size, wrapped
 * rotation, clamped crop. Idempotent — normalizing twice is a no-op. */
export function normalizePlacement(placement: Placement): Placement {
  return {
    id: placement.id,
    photoId: placement.photoId,
    x: Math.round(placement.x),
    y: Math.round(placement.y),
    w: Math.max(MIN_PLACEMENT_SIZE, Math.round(placement.w)),
    h: Math.max(MIN_PLACEMENT_SIZE, Math.round(placement.h)),
    rotation: normalizeRotation(placement.rotation),
    crop: normalizeCrop(placement.crop),
    z: Math.round(placement.z),
    groupId: placement.groupId,
  };
}

/** Canonicalize a board: normalize placements, renumber z to a contiguous
 * 1..N by current z (ties broken by id) so layer order is stable regardless of
 * how the placements were produced. */
export function normalizeBoard(board: Board): Board {
  const ordered = [...board.placements]
    .map(normalizePlacement)
    .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((placement, index) => ({ ...placement, z: index + 1 }));
  return {
    id: board.id,
    title: board.title,
    notes: board.notes,
    size: { width: Math.round(board.size.width), height: Math.round(board.size.height) },
    background: board.background,
    placements: ordered,
  };
}

/** Deterministic JSON with a fixed field order (I2): equal boards always
 * serialize to byte-identical strings, so restart/resize/backup-restore round
 * trips are stable. Field order is explicit rather than relying on any object's
 * key insertion order. */
export function serializeBoard(board: Board): string {
  const normalized = normalizeBoard(board);
  return JSON.stringify({
    id: normalized.id,
    title: normalized.title,
    notes: normalized.notes,
    size: { width: normalized.size.width, height: normalized.size.height },
    background: normalized.background,
    placements: normalized.placements.map((p) => ({
      id: p.id,
      photoId: p.photoId,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      rotation: p.rotation,
      crop: { x: p.crop.x, y: p.crop.y, w: p.crop.w, h: p.crop.h },
      z: p.z,
      groupId: p.groupId,
    })),
  });
}

/** Parse and canonicalize a board from untrusted JSON (throws on invalid). */
export function parseBoard(value: string): Board {
  const parsed: unknown = JSON.parse(value);
  return normalizeBoard(boardSchema.parse(parsed));
}

/** True when two boards are logically identical (same canonical bytes). */
export function boardsEqual(a: Board, b: Board): boolean {
  return serializeBoard(a) === serializeBoard(b);
}

export function createEmptyBoard(id: string, title: string): Board {
  return {
    id,
    title,
    notes: '',
    size: DEFAULT_BOARD_SIZE,
    background: DEFAULT_BACKGROUND,
    placements: [],
  };
}
