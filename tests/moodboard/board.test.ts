import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  boardSchema,
  boardsEqual,
  createEmptyBoard,
  normalizeBoard,
  normalizePlacement,
  normalizeRotation,
  parseBoard,
  serializeBoard,
  type Board,
  type Placement,
} from '../../src/shared/moodboard/board.js';

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: 'p1',
    photoId: 'photo-1',
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    rotation: 0,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    z: 1,
    groupId: null,
    ...overrides,
  };
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    id: 'board-1',
    title: 'Summer palette',
    notes: '',
    size: { width: 1600, height: 1200 },
    background: 'ink',
    placements: [placement()],
    ...overrides,
  };
}

describe('board normalization', () => {
  test('rounds coordinates and clamps size to the minimum', () => {
    const n = normalizePlacement(placement({ x: 10.4, y: 20.6, w: 12, h: 3.2 }));
    assert.equal(n.x, 10);
    assert.equal(n.y, 21);
    assert.equal(n.w, 40, 'width clamps up to MIN_PLACEMENT_SIZE');
    assert.equal(n.h, 40, 'height clamps up to MIN_PLACEMENT_SIZE');
  });

  test('normalizeRotation wraps into [0, 360) with 2-decimal precision', () => {
    assert.equal(normalizeRotation(0), 0);
    assert.equal(normalizeRotation(360), 0);
    assert.equal(normalizeRotation(-90), 270);
    assert.equal(normalizeRotation(725.125), 5.13);
    assert.equal(Object.is(normalizeRotation(-0), 0), true, 'no negative zero');
  });

  test('crop fractions clamp into range and never collapse to zero', () => {
    const n = normalizePlacement(placement({ crop: { x: -0.2, y: 0.5, w: 5, h: 0.9 } }));
    assert.equal(n.crop.x, 0);
    assert.equal(n.crop.y, 0.5);
    assert.equal(n.crop.w, 1, 'width clamps to remaining 1 - x');
    assert.equal(n.crop.h, 0.5, 'height clamps to remaining 1 - y');
  });

  test('normalization is idempotent', () => {
    const once = normalizeBoard(board({ placements: [placement({ z: 9 }), placement({ id: 'p2', z: 3 })] }));
    const twice = normalizeBoard(once);
    assert.equal(serializeBoard(once), serializeBoard(twice));
  });

  test('z is renumbered to a contiguous 1..N by layer order', () => {
    const n = normalizeBoard(
      board({ placements: [placement({ id: 'a', z: 50 }), placement({ id: 'b', z: 10 }), placement({ id: 'c', z: 30 })] }),
    );
    assert.deepEqual(
      n.placements.map((p) => [p.id, p.z]),
      [
        ['b', 1],
        ['c', 2],
        ['a', 3],
      ],
    );
  });
});

describe('serialization (I2 byte-stability)', () => {
  test('equal boards serialize to byte-identical strings regardless of placement order', () => {
    const a = board({ placements: [placement({ id: 'a', z: 1 }), placement({ id: 'b', z: 2 })] });
    const b = board({ placements: [placement({ id: 'b', z: 2 }), placement({ id: 'a', z: 1 })] });
    assert.equal(serializeBoard(a), serializeBoard(b));
    assert.equal(boardsEqual(a, b), true);
  });

  test('serialize → parse → serialize round-trips to identical bytes', () => {
    const original = board({
      notes: 'beach tones',
      placements: [placement({ id: 'a', rotation: 725, z: 2 }), placement({ id: 'b', x: 5.7, z: 1 })],
    });
    const bytes = serializeBoard(original);
    const restored = parseBoard(bytes);
    assert.equal(serializeBoard(restored), bytes, 'restart/backup-restore round trip is stable');
  });

  test('differing layout produces different bytes', () => {
    const a = board();
    const b = board({ placements: [placement({ x: 999 })] });
    assert.notEqual(serializeBoard(a), serializeBoard(b));
    assert.equal(boardsEqual(a, b), false);
  });
});

describe('parse validation', () => {
  test('parseBoard rejects malformed input', () => {
    assert.throws(() => parseBoard('{"id":"x"}'));
    assert.throws(() => parseBoard('not json'));
  });

  test('boardSchema rejects sub-minimum placement sizes and empty ids', () => {
    assert.equal(boardSchema.safeParse(board()).success, true);
    assert.equal(boardSchema.safeParse({ ...board(), placements: [{ ...placement(), w: 10 }] }).success, false);
    assert.equal(boardSchema.safeParse({ ...board(), id: '' }).success, false);
  });
});

describe('createEmptyBoard', () => {
  test('produces a valid empty board with defaults', () => {
    const empty = createEmptyBoard('b9', 'Untitled');
    assert.equal(empty.placements.length, 0);
    assert.equal(empty.background, 'ink');
    assert.deepEqual(empty.size, { width: 1600, height: 1200 });
    assert.equal(boardSchema.safeParse(empty).success, true);
  });
});
