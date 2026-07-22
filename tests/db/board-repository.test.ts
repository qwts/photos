import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { deleteBoard, getBoard, listBoards, saveBoard } from '../../src/main/db/board-repository.js';
import { serializeBoard, type Board } from '../../src/shared/moodboard/board.js';

const CLOCK = (): string => '2026-07-22T00:00:00.000Z';

function dbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'overlook-boards-')), 'library.db');
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    id: 'board-1',
    title: 'Summer palette',
    notes: 'warm tones',
    size: { width: 1600, height: 1200 },
    background: 'ink',
    placements: [
      { id: 'p1', photoId: 'ph1', x: 100, y: 100, w: 200, h: 150, rotation: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, z: 1, groupId: null },
      {
        id: 'p2',
        photoId: 'ph2',
        x: 400,
        y: 200,
        w: 180,
        h: 120,
        rotation: 45,
        crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        z: 2,
        groupId: 'g1',
      },
    ],
    ...overrides,
  };
}

describe('board repository (#694)', () => {
  test('saves and reloads a board with byte-stable layout (I2)', () => {
    const db = openLibraryDatabase({ path: dbPath(), dbKey: randomBytes(32) });
    const original = board();
    saveBoard(db, original, CLOCK);
    const loaded = getBoard(db, 'board-1');
    assert.notEqual(loaded, null);
    assert.equal(serializeBoard(loaded as Board), serializeBoard(original), 'layout round-trips identically');
  });

  test('layout is byte-stable across a database reopen (restart)', () => {
    const path = dbPath();
    const key = randomBytes(32);
    const first = openLibraryDatabase({ path, dbKey: key });
    saveBoard(first, board(), CLOCK);
    const expected = serializeBoard(board());
    first.close();
    const reopened = openLibraryDatabase({ path, dbKey: key });
    const loaded = getBoard(reopened, 'board-1');
    assert.equal(serializeBoard(loaded as Board), expected);
  });

  test('updating a board keeps its position and rewrites placements', () => {
    const db = openLibraryDatabase({ path: dbPath(), dbKey: randomBytes(32) });
    saveBoard(db, board({ id: 'a' }), CLOCK);
    saveBoard(db, board({ id: 'b' }), CLOCK);
    saveBoard(db, board({ id: 'a', title: 'Renamed' }), CLOCK);
    const order = listBoards(db).map((b) => b.id);
    assert.deepEqual(order, ['a', 'b'], 'update does not reorder');
    assert.equal(getBoard(db, 'a')?.title, 'Renamed');
  });

  test('placements referencing absent photos persist without a foreign-key cascade', () => {
    const db = openLibraryDatabase({ path: dbPath(), dbKey: randomBytes(32) });
    // ph1/ph2 do not exist in the photos table; the board still stores them.
    saveBoard(db, board(), CLOCK);
    assert.equal(getBoard(db, 'board-1')?.placements.length, 2);
  });

  test('delete removes the board; missing boards read as null', () => {
    const db = openLibraryDatabase({ path: dbPath(), dbKey: randomBytes(32) });
    saveBoard(db, board(), CLOCK);
    deleteBoard(db, 'board-1');
    assert.equal(getBoard(db, 'board-1'), null);
    assert.deepEqual(listBoards(db), []);
  });
});
