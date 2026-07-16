import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { InteropRepository, InteropRepositoryError } from '../../src/main/interop/interop-repository.js';
import { interopEnvelopeSchema } from '../../src/shared/interop/messages.js';

const RECEIVED_AT = '2026-07-16T12:00:00.000Z';

function fixtureRecord(): ReturnType<typeof interopEnvelopeSchema.parse> & { payload: { kind: 'record' } } {
  const value = JSON.parse(readFileSync('design/handoff/contracts/v1/fixtures/round-trip-record-message.json', 'utf8')) as unknown;
  const envelope = interopEnvelopeSchema.parse(value);
  assert.equal(envelope.payload.kind, 'record');
  return envelope as ReturnType<typeof interopEnvelopeSchema.parse> & { payload: { kind: 'record' } };
}

function openRepository(): { readonly db: ReturnType<typeof openLibraryDatabase>; readonly repository: InteropRepository } {
  const path = join(mkdtempSync(join(tmpdir(), 'overlook-interop-')), 'library.db');
  const db = openLibraryDatabase({ path, dbKey: randomBytes(32) });
  return { db, repository: new InteropRepository(db) };
}

describe('InteropRepository', () => {
  test('round-trips canonical records and unsupported metadata without creating a native photo', () => {
    const { db, repository } = openRepository();
    const envelope = fixtureRecord();
    repository.putRecord({ record: envelope.payload.record, reviewCategory: envelope.payload.reviewCategory, receivedAt: RECEIVED_AT });

    const stored = repository.getRecord(envelope.payload.record.identity.interopId);
    assert.deepEqual(stored?.record, envelope.payload.record);
    assert.equal(stored?.record.roundTripMetadata.overlook['rating'], 4);
    assert.equal(stored?.localPhotoId, null);
    assert.equal(stored?.reviewCategory, envelope.payload.reviewCategory);
    assert.deepEqual(
      repository.findRecordByOrigin(envelope.payload.record.identity.origin.product, envelope.payload.record.identity.origin.localId),
      stored,
    );
    db.close();
  });

  test('indexes content hashes and preserves an established native-photo link on refresh', () => {
    const { db, repository } = openRepository();
    const envelope = fixtureRecord();
    const record = {
      ...envelope.payload.record,
      identity: { ...envelope.payload.record.identity, contentHash: 'a'.repeat(64) },
    };
    db.exec(`INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'wrapped', '${RECEIVED_AT}')`);
    db.exec(`INSERT INTO photos (
      id, file_name, file_kind, width, height, bytes, content_hash, imported_at, import_source, favorite, key_id
    ) VALUES ('native-photo', 'native.jpg', 'jpeg', 1, 1, 1, '${'b'.repeat(64)}', '${RECEIVED_AT}', 'interop', 0, 1)`);

    repository.putRecord({ record, reviewCategory: 'eligible', receivedAt: RECEIVED_AT, localPhotoId: 'native-photo' });
    repository.putRecord({ record, reviewCategory: 'duplicate', receivedAt: '2026-07-16T12:01:00.000Z' });

    const found = repository.findRecordsByContentHash('a'.repeat(64));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.localPhotoId, 'native-photo');
    assert.equal(found[0]?.reviewCategory, 'duplicate');
    db.close();
  });

  test('round-trips canonical albums and fails closed when indexed identity diverges', () => {
    const { db, repository } = openRepository();
    const envelope = fixtureRecord();
    const album = envelope.payload.albums[0];
    assert.ok(album);
    repository.putRecord({ record: envelope.payload.record, reviewCategory: envelope.payload.reviewCategory, receivedAt: RECEIVED_AT });
    repository.putAlbum({ album, receivedAt: RECEIVED_AT });
    assert.deepEqual(repository.getAlbum(album.interopId)?.album, album);

    db.prepare('UPDATE interop_records SET origin_local_id = ? WHERE interop_id = ?').run(
      'corrupt-origin',
      envelope.payload.record.identity.interopId,
    );
    assert.throws(() => repository.getRecord(envelope.payload.record.identity.interopId), InteropRepositoryError);
    db.close();
  });
});
