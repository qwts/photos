import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { queryAll, run } from '../../src/main/db/sql.js';
import { InboundMoveObjectJournal, InboundMoveObjectJournalError } from '../../src/main/interop/inbound-move-object-journal.js';

const KEY = randomBytes(32);
const TRANSFER_ID = '48ced8d7-2f3a-4b60-967f-8f1c27867e65';
const RECORD_MESSAGE_ID = '6af6239d-8ce9-4ac8-b9ca-ffb0e55635cf';
const ACK_MESSAGE_ID = 'c8865ad8-8975-4abe-9a1c-bbde10a71efa';
const INTEROP_ID = 'bf1842f7-56b2-4d84-a7b1-b3bedcddf97b';
const RECORD_PATH = 'transfers/48ced8d7/00000001-record.json';
const DISCOVERED_AT = '2026-07-21T18:00:00.000Z';

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'overlook-inbound-journal-')), 'library.db');
}

function seed(path: string) {
  const db = openLibraryDatabase({ path, dbKey: KEY });
  run(
    db,
    `INSERT INTO interop_move_journals (
       transfer_id, pairing_id, source_product, target_product, phase,
       last_sequence, created_at, updated_at
     ) VALUES (?, ?, 'image-trail', 'overlook', 'reviewing', 0, ?, ?)`,
    TRANSFER_ID,
    '3deed79f-28a4-451d-9a24-3cad23a6b891',
    DISCOVERED_AT,
    DISCOVERED_AT,
  );
  return db;
}

const discovery = {
  transferId: TRANSFER_ID,
  sourceMessageId: RECORD_MESSAGE_ID,
  objectPath: RECORD_PATH,
  objectKind: 'record-message',
  sequence: 1,
  interopId: INTEROP_ID,
  deterministicTargetId: '01K0OVERLOOKTARGET000000000',
  at: DISCOVERED_AT,
} as const;

test('schema v17 creates the forward-only inbound object journal', () => {
  const db = openLibraryDatabase({ path: databasePath(), dbKey: KEY });
  const columns = queryAll<{ name: string }>(db, 'PRAGMA table_info(interop_move_inbound_objects)');
  assert.deepEqual(
    columns.map((column) => column.name),
    [
      'transfer_id',
      'source_message_id',
      'object_path',
      'object_kind',
      'sequence',
      'interop_id',
      'deterministic_target_id',
      'phase',
      'retry_count',
      'retry_at',
      'acknowledgement_message_id',
      'error_json',
      'discovered_at',
      'updated_at',
    ],
  );
  db.close();
});

test('discovery is idempotent, collision-safe, and survives restart before side effects', () => {
  const path = databasePath();
  let db = seed(path);
  let journal = new InboundMoveObjectJournal(db);
  assert.equal(journal.discover(discovery).phase, 'discovered');
  assert.deepEqual(journal.discover(discovery), journal.require(TRANSFER_ID, RECORD_PATH));
  assert.throws(
    () => journal.discover({ ...discovery, sequence: 2 }),
    (error: unknown) => error instanceof InboundMoveObjectJournalError && /collides/u.test(error.message),
  );
  db.close();

  db = openLibraryDatabase({ path, dbKey: KEY });
  journal = new InboundMoveObjectJournal(db);
  const resumed = journal.pending('2026-07-21T18:01:00.000Z');
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.sourceMessageId, RECORD_MESSAGE_ID);
  assert.equal(resumed[0]?.deterministicTargetId, '01K0OVERLOOKTARGET000000000');
  db.close();
});

test('durably advances blob, database, acknowledgement journal, and upload boundaries', () => {
  const db = seed(databasePath());
  const journal = new InboundMoveObjectJournal(db);
  journal.discover(discovery);
  journal.advance(TRANSFER_ID, RECORD_PATH, 'validated', '2026-07-21T18:00:01.000Z');
  journal.advance(TRANSFER_ID, RECORD_PATH, 'database-committed', '2026-07-21T18:00:02.000Z');
  assert.throws(
    () => journal.advance(TRANSFER_ID, RECORD_PATH, 'ack-journaled', '2026-07-21T18:00:03.000Z'),
    /require a durable acknowledgement/u,
  );
  assert.equal(
    journal.advance(TRANSFER_ID, RECORD_PATH, 'ack-journaled', '2026-07-21T18:00:03.000Z', ACK_MESSAGE_ID).phase,
    'ack-journaled',
  );
  const uploaded = journal.advance(TRANSFER_ID, RECORD_PATH, 'ack-uploaded', '2026-07-21T18:00:04.000Z');
  assert.equal(uploaded.acknowledgementMessageId, ACK_MESSAGE_ID);
  assert.deepEqual(journal.pending('2026-07-21T18:00:05.000Z'), []);
  assert.throws(() => journal.advance(TRANSFER_ID, RECORD_PATH, 'validated', '2026-07-21T18:00:06.000Z'), /cannot advance/u);
  db.close();
});

test('retry state is durable and respects its retry time', () => {
  const db = seed(databasePath());
  const journal = new InboundMoveObjectJournal(db);
  journal.discover(discovery);
  const retried = journal.retry(TRANSFER_ID, RECORD_PATH, '2026-07-21T18:05:00.000Z', { code: 'offline' }, '2026-07-21T18:00:01.000Z');
  assert.equal(retried.retryCount, 1);
  assert.deepEqual(retried.error, { code: 'offline' });
  assert.deepEqual(journal.pending('2026-07-21T18:04:59.000Z'), []);
  assert.equal(journal.pending('2026-07-21T18:05:00.000Z').length, 1);
  db.close();
});
