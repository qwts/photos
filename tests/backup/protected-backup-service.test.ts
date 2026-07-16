import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';

import { ProtectedBackupService } from '../../src/main/backup/protected-backup-service.js';
import { MockProvider } from '../../src/main/backup/mock-provider.js';
import { protectedObjectPath } from '../../src/main/backup/protected-object-path.js';
import { ProtectedBlobStore } from '../../src/main/blobs/protected-blob-store.js';
import { ProtectedAlbumAuthorityRegistry } from '../../src/main/crypto/protected-album-authority.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { ProtectedRecoveryRepository } from '../../src/main/db/protected-recovery-repository.js';
import { runNamed } from '../../src/main/db/sql.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'overlook-protected-backup-'));
  const db = openLibraryDatabase({ path: join(root, 'library.db'), dbKey: randomBytes(32) });
  const albumId = 'album-private';
  const photoId = 'photo-private';
  const albumKey = randomBytes(32);
  const plaintext = Buffer.from('private original bytes');
  const contentHash = createHash('sha256').update(plaintext).digest('hex');
  const blobs = new ProtectedBlobStore(join(root, 'local'));
  const provider = new MockProvider({ rootDir: join(root, 'remote') });
  const authorities = new ProtectedAlbumAuthorityRegistry();
  const repository = new ProtectedRecoveryRepository(db);
  const audits: string[] = [];
  const service = new ProtectedBackupService({
    provider,
    repository,
    blobs,
    authorities,
    now: () => new Date('2026-07-16T12:00:00.000Z'),
    audit: (line) => audits.push(line),
  });
  return { root, db, albumId, photoId, albumKey, plaintext, contentHash, blobs, provider, authorities, repository, audits, service };
}

async function seed() {
  const value = fixture();
  await value.blobs.init();
  const blobRef = await value.blobs.putOriginal({
    albumId: value.albumId,
    albumKey: value.albumKey,
    contentHash: value.contentHash,
    plaintext: Readable.from(value.plaintext),
  });
  const at = '2026-07-16T11:00:00.000Z';
  runNamed(
    value.db,
    `INSERT INTO protected_album_records (
       album_id, record_version, migration_state, credential_generation, metadata_generation,
       credential_record, sealed_metadata, created_at, updated_at
     ) VALUES (@albumId, 1, 'active', 1, 1, @credential, @metadata, @at, @at)`,
    { albumId: value.albumId, credential: Buffer.from('credential'), metadata: Buffer.from('album'), at },
  );
  runNamed(
    value.db,
    `INSERT INTO protected_photo_records (
       photo_id, album_id, record_version, blob_ref, sealed_metadata, has_thumb, has_mid, created_at, updated_at
     ) VALUES (@photoId, @albumId, 1, @blobRef, @metadata, 0, 0, @at, @at)`,
    { photoId: value.photoId, albumId: value.albumId, blobRef, metadata: Buffer.from('photo'), at },
  );
  runNamed(value.db, `INSERT INTO protected_remote_objects (photo_id, kind) VALUES (@photoId, 'original')`, {
    photoId: value.photoId,
  });
  value.authorities.authorize(value.albumId, value.albumKey);
  return { ...value, blobRef };
}

describe('ProtectedBackupService (#328)', () => {
  test('uploads only ciphertext under opaque paths and emits redacted audit records', async () => {
    const value = await seed();
    const result = await value.service.run();
    assert.deepEqual(result, { uploaded: 1, failed: 0 });
    const path = protectedObjectPath(value.blobRef, 'original');
    assert.deepEqual(
      (await value.provider.list('protected')).map((entry) => entry.path),
      [path],
    );
    assert.ok(!path.includes(value.albumId));
    assert.ok(!path.includes(value.contentHash));
    assert.deepEqual(value.audits, ['PROTECTED-VERIFY-OK']);
    const snapshot = value.repository.snapshot();
    assert.equal(snapshot.protectedPhotos[0]?.objects[0]?.status, 'synced');
    value.db.close();
  });

  test('repairs remote corruption, verifies before offload, and rehydrates only while unlocked', async () => {
    const value = await seed();
    await value.service.run();
    const path = protectedObjectPath(value.blobRef, 'original');
    await value.provider.put(path, Readable.from('corrupt'));
    assert.deepEqual(await value.service.scrub(), { checked: 1, repaired: 1, unrecoverable: 0, cycleComplete: true });
    await value.service.offload(value.albumId, value.photoId);
    assert.equal(value.blobs.has(value.albumId, value.blobRef, 'original'), false);
    assert.equal(value.repository.objects(value.photoId)[0]?.status, 'offloaded');
    await value.service.rehydrate(value.albumId, value.photoId);
    assert.equal(value.blobs.has(value.albumId, value.blobRef, 'original'), true);
    assert.equal(value.repository.objects(value.photoId)[0]?.status, 'synced');
    value.authorities.relock(value.albumId);
    await assert.rejects(value.service.offload(value.albumId, value.photoId), /locked/u);
    value.db.close();
  });
});
