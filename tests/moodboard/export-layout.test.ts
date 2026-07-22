import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Board, Placement } from '../../src/shared/moodboard/board.js';
import type { PlacementAvailability } from '../../src/shared/moodboard/availability.js';
import { composeExportLayout, isFullyOutside } from '../../src/shared/moodboard/export-layout.js';

function placement(id: string, over: Partial<Placement> = {}): Placement {
  return {
    id,
    photoId: 'ph-' + id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    z: 1,
    groupId: null,
    ...over,
  };
}

const board: Board = {
  id: 'b1',
  title: 'T',
  notes: '',
  size: { width: 800, height: 600 },
  background: 'ink',
  placements: [
    placement('a', { x: 100, y: 100, w: 200, h: 150, z: 1 }),
    placement('b', { x: 400, y: 300, w: 100, h: 100, z: 2 }),
    placement('locked', { x: 0, y: 0, w: 100, h: 100, z: 3 }),
    placement('gone', { x: 500, y: 500, w: 100, h: 100, z: 4 }),
  ],
};

const availability: Record<string, PlacementAvailability> = {
  a: 'available',
  b: 'offloaded',
  locked: 'locked',
  gone: 'unavailable',
};

describe('export layout (I4 geometry + I6 export isolation)', () => {
  const layout = composeExportLayout(
    board,
    { width: 1600, height: 1200 },
    (p) => availability[p.photoId.replace('ph-', '')] ?? 'available',
  );

  test('scales board rectangles to the declared output size', () => {
    const a = layout.items.find((item) => item.placementId === 'a');
    // 2x scale on both axes (1600/800, 1200/600).
    assert.deepEqual(a?.dest, { x: 200, y: 200, w: 400, h: 300 });
  });

  test('renders in back-to-front (z ascending) order', () => {
    assert.deepEqual(
      layout.items.map((item) => item.placementId),
      ['a', 'b'],
    );
  });

  test('locked and unavailable placements are skipped and counted, never drawn', () => {
    assert.equal(
      layout.items.some((item) => item.placementId === 'locked'),
      false,
      'locked pixels never rasterize (I6)',
    );
    assert.equal(
      layout.items.some((item) => item.placementId === 'gone'),
      false,
    );
    assert.equal(layout.skippedLocked, 1);
    assert.equal(layout.skippedUnavailable, 1);
    assert.equal(layout.skipped, 2);
  });

  test('preserves rotation and crop through the mapping', () => {
    const rotated = composeExportLayout(
      { ...board, placements: [placement('r', { rotation: 45, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } })] },
      board.size,
      () => 'available',
    );
    assert.equal(rotated.items[0]?.rotation, 45);
    assert.deepEqual(rotated.items[0]?.crop, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  });
});

describe('isFullyOutside', () => {
  const size = { width: 800, height: 600 };
  test('detects placements entirely beyond the board rectangle', () => {
    assert.equal(isFullyOutside(placement('x', { x: 900, y: 0 }), size), true);
    assert.equal(isFullyOutside(placement('x', { x: -200, y: 0, w: 100 }), size), true);
    assert.equal(isFullyOutside(placement('x', { x: 100, y: 100 }), size), false);
  });
});
