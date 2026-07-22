// Placement content availability + rasterization policy (#693, invariant I6).
// A placement references a photo whose bytes may be present, offloaded to a
// derivative, missing, or sealed inside a locked album. The canvas and the
// exporter both consult these predicates so that locked pixels never render on
// screen or in an export while the album is locked, and unavailable originals
// hold their slot honestly instead of breaking the layout.

export type PlacementAvailability = 'available' | 'offloaded' | 'unavailable' | 'locked';

export const PLACEMENT_AVAILABILITIES: readonly PlacementAvailability[] = ['available', 'offloaded', 'unavailable', 'locked'];

/** Whether real pixels may be drawn for this placement on the canvas. Locked
 * content is redacted (never drawn); unavailable content has no bytes to draw;
 * offloaded content renders from its bounded preview derivative. */
export function canRenderPixels(availability: PlacementAvailability): boolean {
  return availability === 'available' || availability === 'offloaded';
}

/** The invariant-I6 guard: locked/protected content is never rasterized on the
 * canvas or in an export while locked, regardless of context. */
export function neverRasterizes(availability: PlacementAvailability): boolean {
  return availability === 'locked';
}

export type ExportDisposition = 'render' | 'skip-unavailable' | 'skip-locked';

/** How the exporter treats a placement: rendered, or skipped (and why). Locked
 * and unavailable content is skipped and reported as a count, never silently
 * dropped or force-downloaded. */
export function exportDisposition(availability: PlacementAvailability): ExportDisposition {
  switch (availability) {
    case 'available':
    case 'offloaded':
      return 'render';
    case 'unavailable':
      return 'skip-unavailable';
    case 'locked':
      return 'skip-locked';
  }
}

export function isSkipped(disposition: ExportDisposition): boolean {
  return disposition !== 'render';
}
