import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { run } from '../../src/main/db/sql.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { boardsSnapshot, getBoard, restoreBoards, saveBoard } from '../../src/main/db/board-repository.js';
import { buildBackupManifestV5, parseBackupManifest } from '../../src/main/backup/backup-manifest.js';
import { serializeBoard, type Board } from '../../src/shared/moodboard/board.js';

const CLOCK = (): string => '2026-07-22T00:00:00.000Z';
const LIB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function openDb() {
  return openLibraryDatabase({ path: join(mkdtempSync(join(tmpdir(), 'overlook-board-backup-')), 'library.db'), dbKey: randomBytes(32) });
}

function board(): Board {
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
  };
}

describe('board backup/restore (#701, invariant I2)', () => {
  test('boards round-trip byte-stably through a snapshot + restore', () => {
    const src = openDb();
    saveBoard(src, board(), CLOCK);
    const snapshot = boardsSnapshot(src);
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0]?.position, 0);

    const dst = openDb();
    restoreBoards(dst, snapshot);
    const restored = getBoard(dst, 'board-1');
    assert.notEqual(restored, null);
    assert.equal(serializeBoard(restored as Board), serializeBoard(board()), 'restored layout is byte-identical');
  });

  test('a V5 manifest carries boards and validates on parse', () => {
    const src = openDb();
    run(src, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'w', ?)`, '2026-07-01T00:00:00Z');
    saveBoard(src, board(), CLOCK);
    const base = new PhotosRepository(src).manifestSnapshot();

    const manifest = buildBackupManifestV5({
      libraryId: LIB_ID,
      generatedAt: '2026-07-22T00:00:00.000Z',
      snapshot: { ...base, protectedAlbums: [], protectedPhotos: [], activity: [], boards: boardsSnapshot(src) },
    });
    assert.equal(manifest.schema, 5);

    const parsed = parseBackupManifest(JSON.parse(JSON.stringify(manifest)));
    assert.equal(parsed.restorable, true);
    assert.equal(parsed.restorable && parsed.manifest.schema, 5);
    assert.equal(parsed.restorable && parsed.manifest.schema === 5 ? parsed.manifest.boards[0]?.id : null, 'board-1');
  });

  test('the manifest rejects duplicate board ids', () => {
    const src = openDb();
    run(src, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'w', ?)`, '2026-07-01T00:00:00Z');
    const base = new PhotosRepository(src).manifestSnapshot();
    const one = { ...board(), position: 0, createdAt: CLOCK() };
    assert.throws(() =>
      buildBackupManifestV5({
        libraryId: LIB_ID,
        generatedAt: '2026-07-22T00:00:00.000Z',
        snapshot: { ...base, protectedAlbums: [], protectedPhotos: [], activity: [], boards: [one, { ...one, position: 1 }] },
      }),
    );
  });
});
