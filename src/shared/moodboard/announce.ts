import type { AlignEdge, DistributeAxis } from './geometry.js';

// Live-region strings (#693, invariant I5). These are the exact announcements
// from the design spec's §05 table. They are pure so the DOM/unit lane can
// assert them verbatim, and the renderer emits them through one serialized
// polite region. Overlook voice: calm, factual, sentence case, no scare words.

/** "×" (U+00D7), the spec's dimension separator — not the letter x. */
const TIMES = '×';

export function announceMoved(x: number, y: number): string {
  return `Moved to ${Math.round(x)}, ${Math.round(y)}.`;
}

export function announceResized(w: number, h: number): string {
  return `Resized to ${Math.round(w)} ${TIMES} ${Math.round(h)}.`;
}

export function announceBroughtForward(layer: number, total: number): string {
  return `Brought forward. Layer ${layer} of ${total}.`;
}

export function announceSentBack(layer: number, total: number): string {
  return `Sent back. Layer ${layer} of ${total}.`;
}

export function announceGrouped(count: number): string {
  return `Grouped ${count} photos.`;
}

export function announceUngrouped(): string {
  return 'Ungrouped.';
}

const ALIGN_WORDS: Record<AlignEdge, string> = {
  left: 'left',
  hcenter: 'center',
  right: 'right',
  top: 'top',
  vmiddle: 'middle',
  bottom: 'bottom',
};

export function announceAligned(edge: AlignEdge): string {
  return `Aligned ${ALIGN_WORDS[edge]}.`;
}

export function announceDistributed(axis: DistributeAxis): string {
  return `Distributed ${axis === 'horizontal' ? 'horizontally' : 'vertically'}.`;
}

export function announceAdded(): string {
  return 'Added to board.';
}

export function announceRemoved(): string {
  return 'Removed from board.';
}

export function announceExported(width: number, height: number): string {
  return `Board exported at ${Math.round(width)} ${TIMES} ${Math.round(height)}.`;
}

export function announceSkipped(count: number): string {
  return `${count} placements skipped — locked or unavailable.`;
}
