import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { queryGet } from '../../src/main/db/sql.js';
import { InteropRepository } from '../../src/main/interop/interop-repository.js';
import { deterministicInteropId } from '../../src/main/interop/record-translation.js';
import { InteropTranslationService } from '../../src/main/interop/translation-service.js';
import { interopEnvelopeSchema } from '../../src/shared/interop/messages.js';
import type { InteropAlbum, InteropRecord } from '../../src/shared/interop/records.js';

const RECEIVED_AT = '2026-07-16T14:00:00.000Z';

function openService(): {
  readonly db: ReturnType<typeof openLibraryDatabase>;
  readonly repository: InteropRepository;
  readonly service: InteropTranslationService;
} {
  const path = join(mkdtempSync(join(tmpdir(), 'overlook-translation-')), 'library.db');
  const db = openLibraryDatabase({ path, dbKey: randomBytes(32) });
  const repository = new InteropRepository(db);
  return { db, repository, service: new InteropTranslationService(repository, new PhotosRepository(db)) };
}

function canonicalPayload(): { readonly record: InteropRecord; readonly albums: readonly InteropAlbum[] } {
  const value = JSON.parse(readFileSync('design/handoff/contracts/v1/fixtures/round-trip-record-message.json', 'utf8')) as unknown;
  const envelope = interopEnvelopeSchema.parse(value);
  assert.equal(envelope.payload.kind, 'record');
  return envelope.payload.kind === 'record'
    ? { record: envelope.payload.record, albums: envelope.payload.albums }
    : assert.fail('record fixture expected');
}

function canonicalRecord(): InteropRecord {
  return canonicalPayload().record;
}

function plainFullBackup(): string {
  return JSON.stringify({
    format: 'image-trail.records',
    formatVersion: 1,
    payloadType: 'bookmarks',
    createdAt: RECEIVED_AT,
    recordCount: 1,
    entries: [
      {
        uuid: 'bookmark-1',
        payload: {
          url: 'https://example.test/bookmark.jpg',
          title: 'Bookmark',
          bookmarkedAt: '2026-07-16T13:00:00.000Z',
          storedOriginal: {
            blobId: 'unavailable-original',
            mimeType: 'image/jpeg',
            byteLength: 42,
            capturedAt: '2026-07-16T13:05:00.000Z',
          },
        },
      },
    ],
  });
}

describe('InteropTranslationService', () => {
  test('persists compatibility imports as metadata-only records without native photo rows', async () => {
    const { db, repository, service } = openService();
    const result = await service.importCompatibilityFile({ fileContent: plainFullBackup(), receivedAt: RECEIVED_AT });

    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.reviewCategory, 'metadata-only');
    assert.equal(result.records[0]?.persisted, true);
    const id = deterministicInteropId('image-trail', 'bookmark-1');
    assert.equal(repository.getRecord(id)?.record.timestamps.takenAt, null);
    assert.equal(repository.getRecord(id)?.localPhotoId, null);
    assert.equal(queryGet<{ count: number }>(db, 'SELECT count(*) AS count FROM photos')?.count, 0);
    assert.deepEqual(service.exportRecord(id)?.record, repository.getRecord(id)?.record);
    db.close();
  });

  test('detects native content duplicates before persisting canonical metadata', () => {
    const { db, repository, service } = openService();
    const record = canonicalRecord();
    db.exec(`INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'wrapped', '${RECEIVED_AT}')`);
    db.prepare(
      `INSERT INTO photos (
        id, file_name, file_kind, width, height, bytes, content_hash, imported_at, import_source, favorite, key_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('native', 'photo.jpg', 'jpeg', 1200, 800, 42, record.identity.contentHash, RECEIVED_AT, 'local', 0, 1);

    const result = service.importRecord({ record, receivedAt: RECEIVED_AT });
    assert.equal(result.reviewCategory, 'duplicate');
    assert.equal(repository.getRecord(record.identity.interopId)?.reviewCategory, 'duplicate');
    db.close();
  });

  test('persists and exports canonical albums with exact round-trip metadata', () => {
    const { db, repository, service } = openService();
    const payload = canonicalPayload();

    const result = service.importCanonicalPayload({ ...payload, receivedAt: RECEIVED_AT });
    assert.equal(result.record.reviewCategory, 'eligible');
    assert.deepEqual(repository.getAlbum(payload.albums[0]?.interopId ?? '')?.album, payload.albums[0]);
    assert.deepEqual(service.exportRecord(payload.record.identity.interopId), {
      record: payload.record,
      albums: payload.albums,
      reviewCategory: 'eligible',
    });
    db.close();
  });

  test('leaves divergent identities for the same remote origin unpersisted as conflicts', () => {
    const { db, repository, service } = openService();
    const first = canonicalRecord();
    repository.putRecord({ record: first, reviewCategory: 'eligible', receivedAt: RECEIVED_AT });
    const second = { ...first, identity: { ...first.identity, interopId: '780a1b7c-7892-486d-9723-7dc9195f40f7' } };

    const result = service.importRecord({ record: second, receivedAt: RECEIVED_AT });
    assert.equal(result.reviewCategory, 'conflict');
    assert.equal(result.persisted, false);
    assert.equal(repository.getRecord(first.identity.interopId)?.record.identity.interopId, first.identity.interopId);
    db.close();
  });

  test('rejects available originals whose content hash disagrees with record identity', () => {
    const { db, service } = openService();
    const record = canonicalRecord();
    const mismatched = { ...record, original: { ...record.original, contentHash: 'b'.repeat(64) } } as InteropRecord;
    assert.throws(() => service.importRecord({ record: mismatched, receivedAt: RECEIVED_AT }), /content hash does not match/u);
    db.close();
  });
});
