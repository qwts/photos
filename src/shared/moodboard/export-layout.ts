import type { Board, BoardSize, CropFrame, Placement } from './board.js';
import { readingOrder } from './reading-order.js';
import { exportDisposition, type ExportDisposition, type PlacementAvailability } from './availability.js';

// Export geometry (#693, invariant I4 — pure core). The exporter composes the
// board to a declared output size and color space. The pixel/color rasterizer
// lands in a later slice (pending export-owner confirmation), but the geometry
// mapping is pure and testable now: each placement's board rectangle maps to an
// output rectangle by the board→output scale, preserving rotation and crop, and
// locked/unavailable placements are skipped with an honest count. This is the
// composition the raster step must match exactly.

export interface ExportRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ExportItem {
  readonly placementId: string;
  readonly photoId: string;
  /** Destination rectangle in output pixels. */
  readonly dest: ExportRect;
  readonly rotation: number;
  readonly crop: CropFrame;
  /** Draw order, back to front. */
  readonly z: number;
}

export interface ExportLayout {
  readonly output: BoardSize;
  /** Items to draw, in back-to-front order; locked/unavailable are excluded. */
  readonly items: readonly ExportItem[];
  /** Count of placements skipped because they are locked or unavailable. */
  readonly skipped: number;
  readonly skippedLocked: number;
  readonly skippedUnavailable: number;
}

function scaleRect(placement: Placement, sx: number, sy: number): ExportRect {
  return {
    x: placement.x * sx,
    y: placement.y * sy,
    w: placement.w * sx,
    h: placement.h * sy,
  };
}

/**
 * Compose the pure export layout for a board at `output` dimensions.
 * `availabilityOf` resolves each placement's runtime availability; locked and
 * unavailable placements are skipped (I6) and counted (I4 "skipped" report).
 */
export function composeExportLayout(
  board: Board,
  output: BoardSize,
  availabilityOf: (placement: Placement) => PlacementAvailability,
): ExportLayout {
  const sx = output.width / board.size.width;
  const sy = output.height / board.size.height;
  const items: ExportItem[] = [];
  let skippedLocked = 0;
  let skippedUnavailable = 0;
  for (const placement of readingOrder(board)) {
    const disposition: ExportDisposition = exportDisposition(availabilityOf(placement));
    if (disposition === 'skip-locked') {
      skippedLocked += 1;
      continue;
    }
    if (disposition === 'skip-unavailable') {
      skippedUnavailable += 1;
      continue;
    }
    items.push({
      placementId: placement.id,
      photoId: placement.photoId,
      dest: scaleRect(placement, sx, sy),
      rotation: placement.rotation,
      crop: placement.crop,
      z: placement.z,
    });
  }
  return {
    output: { width: Math.round(output.width), height: Math.round(output.height) },
    items,
    skipped: skippedLocked + skippedUnavailable,
    skippedLocked,
    skippedUnavailable,
  };
}

/** True when a placement's board rectangle lies fully outside the board bounds
 * (export clips to the board rectangle and warns for these). */
export function isFullyOutside(placement: Placement, size: BoardSize): boolean {
  return placement.x + placement.w <= 0 || placement.y + placement.h <= 0 || placement.x >= size.width || placement.y >= size.height;
}
