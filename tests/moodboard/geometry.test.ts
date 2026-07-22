import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Placement } from '../../src/shared/moodboard/board.js';
import {
  alignPlacements,
  boundingBox,
  bringForward,
  bringToFront,
  distributePlacements,
  expandGroupSelection,
  groupPlacements,
  isRotationDetent,
  movePlacements,
  resizeBy,
  resizePlacement,
  rotatePlacement,
  sendBackward,
  sendToBack,
  setCrop,
  ungroupPlacements,
} from '../../src/shared/moodboard/geometry.js';

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: 'p1',
    photoId: 'photo-1',
    x: 100,
    y: 100,
    w: 100,
    h: 80,
    rotation: 0,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    z: 1,
    groupId: null,
    ...overrides,
  };
}

describe('move (I1 no-mutation, I3 independence)', () => {
  test('translates only the selected placements and preserves untouched identity', () => {
    const a = placement({ id: 'a' });
    const b = placement({ id: 'b', x: 300 });
    const next = movePlacements([a, b], ['a'], 10, -5);
    assert.deepEqual([next[0]?.x, next[0]?.y], [110, 95]);
    assert.equal(next[1], b, 'untouched placement keeps its exact reference');
    assert.equal(a.x, 100, 'input placement is not mutated');
  });

  test('a zero move returns a fresh array of the same placements', () => {
    const a = placement({ id: 'a' });
    const next = movePlacements([a], ['a'], 0, 0);
    assert.notEqual(next, undefined);
    assert.equal(next[0], a);
  });
});

describe('resize', () => {
  test('SE corner grows width/height, NW anchored', () => {
    const p = placement();
    const r = resizePlacement(p, 'se', 20, 10, false);
    assert.deepEqual([r.x, r.y, r.w, r.h], [100, 100, 120, 90]);
  });

  test('NW corner keeps the opposite (SE) corner fixed', () => {
    const p = placement();
    const r = resizePlacement(p, 'nw', -20, -10, false);
    // width 120, height 90; x/y shift so right/bottom edges stay at 200/180.
    assert.deepEqual([r.x + r.w, r.y + r.h], [200, 180]);
  });

  test('aspect lock keeps the original ratio', () => {
    const p = placement({ w: 100, h: 50 });
    const r = resizePlacement(p, 'se', 40, 0, true);
    assert.equal(r.w / r.h, 2);
  });

  test('resize clamps to the minimum size', () => {
    const r = resizePlacement(placement({ w: 50, h: 50 }), 'se', -100, -100, false);
    assert.deepEqual([r.w, r.h], [40, 40]);
  });

  test('resizeBy grows from the SE corner', () => {
    const r = resizeBy(placement(), 10, 10, false);
    assert.deepEqual([r.w, r.h], [110, 90]);
  });
});

describe('rotate', () => {
  test('adds degrees and wraps', () => {
    assert.equal(rotatePlacement(placement({ rotation: 350 }), 20, false).rotation, 10);
  });

  test('snap rounds to 15-degree increments', () => {
    assert.equal(rotatePlacement(placement({ rotation: 0 }), 22, true).rotation, 15);
    assert.equal(rotatePlacement(placement({ rotation: 0 }), 8, true).rotation, 15);
  });

  test('detent recognizes square rotations', () => {
    assert.equal(isRotationDetent(0), true);
    assert.equal(isRotationDetent(90), true);
    assert.equal(isRotationDetent(270), true);
    assert.equal(isRotationDetent(45), false);
  });
});

describe('crop', () => {
  test('setCrop replaces and clamps the crop window', () => {
    const r = setCrop(placement(), { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    assert.deepEqual(r.crop, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });
});

describe('layer order', () => {
  const base = [placement({ id: 'a', z: 1 }), placement({ id: 'b', z: 2 }), placement({ id: 'c', z: 3 })];
  const zById = (ps: readonly Placement[]): Record<string, number> => Object.fromEntries(ps.map((p) => [p.id, p.z]));

  test('bringToFront / sendToBack move to the extremes', () => {
    assert.equal(zById(bringToFront(base, ['a']))['a'], 3);
    assert.equal(zById(sendToBack(base, ['c']))['c'], 1);
  });

  test('bringForward / sendBackward step by one', () => {
    assert.deepEqual(zById(bringForward(base, ['a'])), { b: 1, a: 2, c: 3 });
    assert.deepEqual(zById(sendBackward(base, ['c'])), { a: 1, c: 2, b: 3 });
  });

  test('empty selection is a no-op copy', () => {
    assert.deepEqual(zById(bringToFront(base, [])), { a: 1, b: 2, c: 3 });
  });
});

describe('align / distribute', () => {
  const trio = [
    placement({ id: 'a', x: 0, y: 0, w: 100, h: 100 }),
    placement({ id: 'b', x: 200, y: 50, w: 100, h: 100 }),
    placement({ id: 'c', x: 400, y: 300, w: 100, h: 100 }),
  ];
  const xById = (ps: readonly Placement[]): Record<string, number> => Object.fromEntries(ps.map((p) => [p.id, p.x]));
  const yById = (ps: readonly Placement[]): Record<string, number> => Object.fromEntries(ps.map((p) => [p.id, p.y]));

  test('aligns to every edge/center of the selection box', () => {
    assert.equal(xById(alignPlacements(trio, ['a', 'b', 'c'], 'left'))['c'], 0);
    assert.equal(xById(alignPlacements(trio, ['a', 'b', 'c'], 'right'))['a'], 400);
    assert.equal(xById(alignPlacements(trio, ['a', 'b', 'c'], 'hcenter'))['a'], 200);
    assert.equal(yById(alignPlacements(trio, ['a', 'b', 'c'], 'top'))['c'], 0);
    assert.equal(yById(alignPlacements(trio, ['a', 'b', 'c'], 'bottom'))['a'], 300);
    assert.equal(yById(alignPlacements(trio, ['a', 'b', 'c'], 'vmiddle'))['a'], 150);
  });

  test('empty selection align is a no-op', () => {
    assert.deepEqual(xById(alignPlacements(trio, [], 'left')), { a: 0, b: 200, c: 400 });
  });

  test('distribute evenly spaces centers along the axis', () => {
    const out = distributePlacements(trio, ['a', 'b', 'c'], 'horizontal');
    const [a, b, c] = out.map((p) => p.x + p.w / 2).sort((m, n) => m - n);
    assert.ok(a !== undefined && b !== undefined && c !== undefined);
    assert.equal(b - a, c - b);
  });

  test('distribute needs three placements', () => {
    const pair = trio.slice(0, 2);
    assert.deepEqual(distributePlacements(pair, ['a', 'b'], 'horizontal'), pair);
  });

  test('vertical distribute spaces the y centers', () => {
    const out = distributePlacements(trio, ['a', 'b', 'c'], 'vertical');
    const [a, b, c] = out.map((p) => p.y + p.h / 2).sort((m, n) => m - n);
    assert.ok(a !== undefined && b !== undefined && c !== undefined);
    assert.equal(b - a, c - b);
  });
});

describe('grouping', () => {
  test('group binds two or more; ungroup clears', () => {
    const ps = [placement({ id: 'a' }), placement({ id: 'b' })];
    const grouped = groupPlacements(ps, ['a', 'b'], 'g1');
    assert.equal(
      grouped.every((p) => p.groupId === 'g1'),
      true,
    );
    const ungrouped = ungroupPlacements(grouped, ['a', 'b']);
    assert.equal(
      ungrouped.every((p) => p.groupId === null),
      true,
    );
  });

  test('grouping a single placement is a no-op', () => {
    const ps = [placement({ id: 'a' })];
    assert.deepEqual(groupPlacements(ps, ['a'], 'g1'), ps);
  });

  test('expandGroupSelection pulls in the rest of a group', () => {
    const ps = [placement({ id: 'a', groupId: 'g1' }), placement({ id: 'b', groupId: 'g1' }), placement({ id: 'c' })];
    assert.deepEqual([...expandGroupSelection(ps, ['a'])].sort(), ['a', 'b']);
    assert.deepEqual([...expandGroupSelection(ps, ['c'])], ['c']);
  });
});

describe('boundingBox', () => {
  test('returns null for an empty set', () => {
    assert.equal(boundingBox([]), null);
  });

  test('spans all placements', () => {
    assert.deepEqual(boundingBox([placement({ x: 0, y: 0, w: 50, h: 50 }), placement({ x: 100, y: 100, w: 50, h: 50 })]), {
      x: 0,
      y: 0,
      w: 150,
      h: 150,
    });
  });
});
