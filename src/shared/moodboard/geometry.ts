import { MIN_PLACEMENT_SIZE, ROTATION_DETENTS, ROTATION_SNAP, normalizePlacement, normalizeRotation, type Placement } from './board.js';

// Pure placement transform math (#693). Every function returns a NEW placement
// array; untouched placements keep their exact reference (=== identity), which
// is how independence (invariant I3) and no-mutation (I1) are proven by tests.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** A selection of placement ids — a Set or an array. (Avoids `Iterable<string>`,
 * whose current-lib default type args are `any`.) */
export type PlacementIds = ReadonlySet<string> | readonly string[];

/** Axis-aligned bounding box of one or more placements' unrotated frames. */
export function boundingBox(placements: readonly Placement[]): Rect | null {
  if (placements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Map `fn` over the placements whose id is in `ids`, leaving all others
 * referentially unchanged. */
function mapSelected(placements: readonly Placement[], ids: ReadonlySet<string>, fn: (placement: Placement) => Placement): Placement[] {
  return placements.map((placement) => (ids.has(placement.id) ? fn(placement) : placement));
}

function asSet(ids: PlacementIds): ReadonlySet<string> {
  return new Set<string>(ids);
}

/** Translate every selected placement by (dx, dy) board-space pixels. */
export function movePlacements(placements: readonly Placement[], ids: PlacementIds, dx: number, dy: number): Placement[] {
  const set = asSet(ids);
  if (dx === 0 && dy === 0) return [...placements];
  return mapSelected(placements, set, (p) => ({ ...p, x: Math.round(p.x + dx), y: Math.round(p.y + dy) }));
}

/** Resize a single placement by dragging `corner` by (dx, dy). The opposite
 * corner stays anchored. `keepAspect` locks the original aspect ratio. */
export function resizePlacement(placement: Placement, corner: Corner, dx: number, dy: number, keepAspect: boolean): Placement {
  const east = corner === 'ne' || corner === 'se';
  const south = corner === 'sw' || corner === 'se';
  let w = Math.max(MIN_PLACEMENT_SIZE, Math.round(east ? placement.w + dx : placement.w - dx));
  let h = Math.max(MIN_PLACEMENT_SIZE, Math.round(south ? placement.h + dy : placement.h - dy));
  if (keepAspect) {
    const ratio = placement.w / placement.h;
    // Grow to the axis that moved further, then derive the other from ratio.
    if (Math.abs(w - placement.w) >= Math.abs(h - placement.h)) {
      h = Math.max(MIN_PLACEMENT_SIZE, Math.round(w / ratio));
    } else {
      w = Math.max(MIN_PLACEMENT_SIZE, Math.round(h * ratio));
    }
  }
  const x = east ? placement.x : Math.round(placement.x + (placement.w - w));
  const y = south ? placement.y : Math.round(placement.y + (placement.h - h));
  return { ...placement, x, y, w, h };
}

/** Keyboard resize: grow/shrink from the SE corner (NW anchored) by whole
 * pixels. `keepAspect` mirrors `⌥⇧` free/locked scaling. */
export function resizeBy(placement: Placement, dw: number, dh: number, keepAspect: boolean): Placement {
  return resizePlacement(placement, 'se', dw, dh, keepAspect);
}

/** Rotate by `delta` degrees. `snap` rounds the result to the nearest
 * ROTATION_SNAP increment. */
export function rotatePlacement(placement: Placement, delta: number, snap: boolean): Placement {
  const raw = placement.rotation + delta;
  const rotation = snap ? normalizeRotation(Math.round(raw / ROTATION_SNAP) * ROTATION_SNAP) : normalizeRotation(raw);
  return { ...placement, rotation };
}

/** True when a rotation sits on a 0/90/180/270 detent (guide feedback). */
export function isRotationDetent(rotation: number): boolean {
  return ROTATION_DETENTS.includes(normalizeRotation(rotation));
}

/** Replace a placement's crop window (fractions clamped by normalize). */
export function setCrop(placement: Placement, crop: Placement['crop']): Placement {
  return normalizePlacement({ ...placement, crop });
}

// ---- layer order ---------------------------------------------------------

/** Renumber to a contiguous 1..N by current z (id tiebreak) after a reorder. */
function renumber(placements: readonly Placement[]): Placement[] {
  return [...placements]
    .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((placement, index) => (placement.z === index + 1 ? placement : { ...placement, z: index + 1 }));
}

function reorder(placements: readonly Placement[], ids: PlacementIds, target: (max: number) => number, bump: number): Placement[] {
  const set = asSet(ids);
  if (set.size === 0) return [...placements];
  const max = placements.reduce((m, p) => Math.max(m, p.z), 0);
  const shifted = placements.map((p) => (set.has(p.id) ? { ...p, z: target(max) } : { ...p, z: p.z + bump }));
  return renumber(shifted);
}

/** Bring the selection to the front (highest z). */
export function bringToFront(placements: readonly Placement[], ids: PlacementIds): Placement[] {
  return reorder(placements, ids, (max) => max + 2, 0);
}

/** Send the selection to the back (lowest z). */
export function sendToBack(placements: readonly Placement[], ids: PlacementIds): Placement[] {
  return reorder(placements, ids, () => 0, 1);
}

/** Bring the selection one step forward. */
export function bringForward(placements: readonly Placement[], ids: PlacementIds): Placement[] {
  const set = asSet(ids);
  return renumber(placements.map((p) => (set.has(p.id) ? { ...p, z: p.z + 1.5 } : p)));
}

/** Send the selection one step back. */
export function sendBackward(placements: readonly Placement[], ids: PlacementIds): Placement[] {
  const set = asSet(ids);
  return renumber(placements.map((p) => (set.has(p.id) ? { ...p, z: p.z - 1.5 } : p)));
}

// ---- align / distribute --------------------------------------------------

/** Align the selected placements to a shared edge/center of their bounding box. */
export function alignPlacements(placements: readonly Placement[], ids: PlacementIds, edge: AlignEdge): Placement[] {
  const set = asSet(ids);
  const selected = placements.filter((p) => set.has(p.id));
  const box = boundingBox(selected);
  if (box === null) return [...placements];
  return mapSelected(placements, set, (p) => {
    switch (edge) {
      case 'left':
        return { ...p, x: Math.round(box.x) };
      case 'hcenter':
        return { ...p, x: Math.round(box.x + (box.w - p.w) / 2) };
      case 'right':
        return { ...p, x: Math.round(box.x + box.w - p.w) };
      case 'top':
        return { ...p, y: Math.round(box.y) };
      case 'vmiddle':
        return { ...p, y: Math.round(box.y + (box.h - p.h) / 2) };
      case 'bottom':
        return { ...p, y: Math.round(box.y + box.h - p.h) };
    }
  });
}

/** Evenly space the selected placements along an axis, edges pinned. Requires
 * 3+ placements to have any effect. */
export function distributePlacements(placements: readonly Placement[], ids: PlacementIds, axis: DistributeAxis): Placement[] {
  const set = asSet(ids);
  const selected = placements.filter((p) => set.has(p.id));
  if (selected.length < 3) return [...placements];
  const horizontal = axis === 'horizontal';
  const sorted = [...selected].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return [...placements];
  const startCenter = horizontal ? first.x + first.w / 2 : first.y + first.h / 2;
  const endCenter = horizontal ? last.x + last.w / 2 : last.y + last.h / 2;
  const gap = (endCenter - startCenter) / (sorted.length - 1);
  const targetById = new Map<string, number>();
  sorted.forEach((p, index) => {
    const center = startCenter + gap * index;
    targetById.set(p.id, horizontal ? Math.round(center - p.w / 2) : Math.round(center - p.h / 2));
  });
  return mapSelected(placements, set, (p) => {
    const target = targetById.get(p.id);
    if (target === undefined) return p;
    return horizontal ? { ...p, x: target } : { ...p, y: target };
  });
}

// ---- grouping ------------------------------------------------------------

/** Bind the selected placements into one group (shared groupId). */
export function groupPlacements(placements: readonly Placement[], ids: PlacementIds, groupId: string): Placement[] {
  const set = asSet(ids);
  if (set.size < 2) return [...placements];
  return mapSelected(placements, set, (p) => (p.groupId === groupId ? p : { ...p, groupId }));
}

/** Clear the group binding on the selected placements. */
export function ungroupPlacements(placements: readonly Placement[], ids: PlacementIds): Placement[] {
  const set = asSet(ids);
  return mapSelected(placements, set, (p) => (p.groupId === null ? p : { ...p, groupId: null }));
}

/** All placement ids that belong to the same group(s) as `ids` (so a click on
 * one grouped placement selects its whole group). */
export function expandGroupSelection(placements: readonly Placement[], ids: PlacementIds): Set<string> {
  const set = asSet(ids);
  const groups = new Set<string>();
  for (const p of placements) {
    if (set.has(p.id) && p.groupId !== null) groups.add(p.groupId);
  }
  const result = new Set(set);
  for (const p of placements) {
    if (p.groupId !== null && groups.has(p.groupId)) result.add(p.id);
  }
  return result;
}
