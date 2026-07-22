import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

import type { Board, Placement } from '../../shared/moodboard/board.js';
import { boardBackgroundSchema, normalizeBoard, placementSchema } from '../../shared/moodboard/board.js';
import { queryAll, run, runNamed } from './sql.js';

// Board persistence (#515 / #694). A board is album-class organizational
// metadata stored inside the whole-DB SQLCipher `library.db` (ADR-0004/0005):
// board-level fields live in columns; the ordered placement list is canonical
// JSON in the `placements` column, so layout is byte-stable across restart and
// library switch (invariant I2). Placements are references, so there is no
// photo foreign key — a deleted photo leaves an "unavailable" placement rather
// than cascading the layout away. (Backup/restore inclusion is a follow-up.)

interface BoardRow {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly board_width: number;
  readonly board_height: number;
  readonly background: string;
  readonly placements: string;
}

const placementsSchema = z.array(placementSchema);

function rowToBoard(row: BoardRow): Board {
  const placements: readonly Placement[] = placementsSchema.parse(JSON.parse(row.placements));
  return normalizeBoard({
    id: row.id,
    title: row.title,
    notes: row.notes,
    size: { width: row.board_width, height: row.board_height },
    background: boardBackgroundSchema.parse(row.background),
    placements,
  });
}

const SELECT_COLUMNS = 'id, title, notes, board_width, board_height, background, placements';

/** All boards in board order (the renderer view). */
export function listBoards(db: BetterSqlite3.Database): Board[] {
  return queryAll<BoardRow>(db, `SELECT ${SELECT_COLUMNS} FROM boards ORDER BY position, id`).map(rowToBoard);
}

export function getBoard(db: BetterSqlite3.Database, id: string): Board | null {
  const row = queryAll<BoardRow>(db, `SELECT ${SELECT_COLUMNS} FROM boards WHERE id = @id`, { id })[0];
  return row === undefined ? null : rowToBoard(row);
}

/** Insert or replace a board. New boards are appended (position = max + 1) and
 * stamped with `createdAt`; existing boards keep their position/created_at so
 * layout and ordering are byte-stable across a save (invariant I2). */
export function saveBoard(db: BetterSqlite3.Database, board: Board, now: () => string): void {
  const normalized = normalizeBoard(board);
  db.transaction(() => {
    const existing = queryAll<{ position: number; created_at: string }>(db, `SELECT position, created_at FROM boards WHERE id = @id`, {
      id: normalized.id,
    })[0];
    const maxPosition = queryAll<{ n: number | null }>(db, `SELECT max(position) AS n FROM boards`)[0]?.n ?? -1;
    runNamed(
      db,
      `INSERT INTO boards (id, title, notes, board_width, board_height, background, placements, position, created_at)
         VALUES (@id, @title, @notes, @board_width, @board_height, @background, @placements, @position, @created_at)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, notes = excluded.notes, board_width = excluded.board_width,
         board_height = excluded.board_height, background = excluded.background, placements = excluded.placements`,
      {
        id: normalized.id,
        title: normalized.title,
        notes: normalized.notes,
        board_width: normalized.size.width,
        board_height: normalized.size.height,
        background: normalized.background,
        placements: JSON.stringify(normalized.placements),
        position: existing?.position ?? maxPosition + 1,
        created_at: existing?.created_at ?? now(),
      },
    );
  })();
}

export function deleteBoard(db: BetterSqlite3.Database, id: string): void {
  run(db, `DELETE FROM boards WHERE id = @id`, { id });
}
