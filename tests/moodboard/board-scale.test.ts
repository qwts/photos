import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBoard, parseBoard, serializeBoard, type Board, type Placement } from '../../src/shared/moodboard/board.js';
import { alignPlacements, movePlacements } from '../../src/shared/moodboard/geometry.js';
import { readingOrder } from '../../src/shared/moodboard/reading-order.js';
import { composeExportLayout } from '../../src/shared/moodboard/export-layout.js';

// Scale / perf floor for a large board (#697): the moodboard renders and
// exports from the pure board domain, so its hot path must stay correct and
// well-behaved at 200+ placements. The time budget is generous — it exists to
// catch a pathological (e.g. accidental O(n^2)) regression, not to ratchet a
// tight number that would flake across CI machines.
const COUNT = 250;
const BUDGET_MS = 750;

function bigBoard(): Board {
  const placements: Placement[] = Array.from({ length: COUNT }, (_unused, index) => ({
    id: `pl-${index}`,
    photoId: `photo-${index}`,
    x: (index % 20) * 90,
    y: Math.floor(index / 20) * 70,
    w: 200,
    h: 150,
    rotation: index % 360,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    z: index + 1,
    groupId: null,
  }));
  return { id: 'big', title: 'Big board', notes: '', size: { width: 4000, height: 3000 }, background: 'ink', placements };
}

describe('large board (#697, >=200 placements)', () => {
  test('normalizes, serializes, and reads back byte-stably at scale', () => {
    const board = bigBoard();
    const bytes = serializeBoard(board);
    assert.equal(serializeBoard(parseBoard(bytes)), bytes, 'round-trips identically at 250 placements');
    assert.equal(readingOrder(board).length, COUNT);
  });

  test('a bulk move keeps every untouched placement referentially unchanged (I3 at scale)', () => {
    const board = normalizeBoard(bigBoard());
    const moved = movePlacements(board.placements, ['pl-0', 'pl-1'], 5, 5);
    assert.equal(moved[2], board.placements[2], 'untouched placements keep identity');
    assert.equal(moved[0]?.x, (board.placements[0]?.x ?? 0) + 5);
  });

  test('the whole hot path stays within a generous budget', () => {
    const board = normalizeBoard(bigBoard());
    const ids = board.placements.map((p) => p.id);
    const start = performance.now();
    for (let i = 0; i < 10; i += 1) {
      const bytes = serializeBoard(board);
      const parsed = parseBoard(bytes);
      const aligned = alignPlacements(parsed.placements, ids, 'left');
      const moved = movePlacements(aligned, ids, 1, 1);
      composeExportLayout({ ...parsed, placements: moved }, { width: 8000, height: 6000 }, () => 'available');
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < BUDGET_MS, `hot path over ${COUNT} placements took ${elapsed.toFixed(0)}ms (budget ${BUDGET_MS}ms)`);
  });
});
