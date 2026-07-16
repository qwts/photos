import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { ProtectedAlbumAuthorityError, ProtectedAlbumAuthorityRegistry } from '../../src/main/crypto/protected-album-authority.js';
import type { ProtectedAlbumMetadata } from '../../src/main/crypto/protected-album-credentials.js';
import { ProtectedAlbumService } from '../../src/main/crypto/protected-album-service.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { ProtectedAlbumRepository } from '../../src/main/db/protected-album-repository.js';
import { queryGet, run } from '../../src/main/db/sql.js';
import { sealRecoveryKey } from '../../src/main/crypto/recovery.js';

const LIBRARY_ID = 'LIBRARY1';
const PASSWORD = 'correct horse battery staple';
const NEXT_PASSWORD = 'an entirely different strong phrase';

function metadata(name: string): ProtectedAlbumMetadata {
  return {
    version: 1,
    name,
    createdAt: '2026-07-16T00:00:00.000Z',
    position: 1,
    members: [
      {
        photoId: 'PHOTO1',
        position: 0,
        ordinaryMemberships: [{ albumId: 'ORDINARY', position: 4 }],
      },
    ],
  };
}

function world(): {
  readonly db: ReturnType<typeof openLibraryDatabase>;
  readonly repository: ProtectedAlbumRepository;
  readonly authorities: ProtectedAlbumAuthorityRegistry;
  readonly service: ProtectedAlbumService;
} {
  const path = join(mkdtempSync(join(tmpdir(), 'overlook-protected-album-')), 'library.db');
  const db = openLibraryDatabase({ path, dbKey: randomBytes(32) });
  const repository = new ProtectedAlbumRepository(db, LIBRARY_ID);
  const authorities = new ProtectedAlbumAuthorityRegistry();
  return {
    db,
    repository,
    authorities,
    service: new ProtectedAlbumService({ libraryId: LIBRARY_ID, repository, authorities }),
  };
}

describe('protected album persistence and service (#325)', () => {
  test('migration is independent of ordinary albums and exposes only opaque staged summaries', async () => {
    const w = world();
    const masterKey = randomBytes(32);
    run(w.db, `INSERT INTO albums (id, name, created_at, position) VALUES ('ORDINARY', 'Visible album', ?, 0)`, new Date().toISOString());
    await w.service.provision({ albumId: 'PROTECTED', password: PASSWORD, masterKey, metadata: metadata('Private family') });

    assert.deepEqual(w.repository.listOpaque(), [{ albumId: 'PROTECTED', migrationState: 'staged' }]);
    assert.equal(JSON.stringify(w.repository.listOpaque()).includes('Private family'), false);
    assert.equal(queryGet<{ name: string }>(w.db, `SELECT name FROM albums WHERE id = 'ORDINARY'`)?.name, 'Visible album');

    const first = w.repository.get('PROTECTED');
    assert.ok(first);
    assert.equal(first.credentialGeneration, 1);
    assert.equal(first.metadataGeneration, 1);
    assert.equal(first.credentialRecord.includes(Buffer.from(PASSWORD)), false);
    assert.equal(first.sealedMetadata.includes(Buffer.from('Private family')), false);
    first.credentialRecord.fill(0);
    first.sealedMetadata.fill(0);
    assert.notDeepEqual(w.repository.get('PROTECTED')?.credentialRecord, Buffer.alloc(0));

    masterKey.fill(0);
    w.service.close();
    w.db.close();
  });

  test('session unlock, password change, recovery, and relock preserve sealed metadata', async () => {
    const w = world();
    const masterKey = randomBytes(32);
    await w.service.provision({ albumId: 'PROTECTED', password: PASSWORD, masterKey, metadata: metadata('Private family') });
    assert.equal(w.service.metadata('PROTECTED').name, 'Private family');

    assert.equal(w.service.relock('PROTECTED'), true);
    assert.throws(() => w.service.metadata('PROTECTED'), ProtectedAlbumAuthorityError);
    assert.deepEqual(await w.service.unlock('PROTECTED', 'wrong password'), { ok: false, reason: 'wrong-password' });
    assert.equal((await w.service.unlock('PROTECTED', PASSWORD)).ok, true);

    assert.equal(await w.service.changePassword('PROTECTED', 'wrong password', NEXT_PASSWORD), false);
    assert.equal(await w.service.changePassword('PROTECTED', PASSWORD, NEXT_PASSWORD), true);
    assert.equal(w.repository.get('PROTECTED')?.credentialGeneration, 2);
    w.service.relockAll();
    assert.equal((await w.service.unlock('PROTECTED', PASSWORD)).ok, false);
    assert.equal((await w.service.unlock('PROTECTED', NEXT_PASSWORD)).ok, true);

    const recoveryFile = sealRecoveryKey(masterKey, 'saved recovery password');
    w.service.relockAll();
    assert.deepEqual(
      await w.service.recoverPassword({
        albumId: 'PROTECTED',
        recoveryFile,
        recoveryPassword: 'wrong recovery password',
        nextPassword: 'a third excellent private phrase',
      }),
      { ok: false, reason: 'wrong-recovery-key' },
    );
    const recovered = await w.service.recoverPassword({
      albumId: 'PROTECTED',
      recoveryFile,
      recoveryPassword: 'saved recovery password',
      nextPassword: 'a third excellent private phrase',
    });
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.metadata.name, 'Private family');
    assert.equal(w.repository.get('PROTECTED')?.credentialGeneration, 3);
    w.service.relockAll();
    assert.equal((await w.service.unlock('PROTECTED', NEXT_PASSWORD)).ok, false);
    assert.equal((await w.service.unlock('PROTECTED', 'a third excellent private phrase')).ok, true);

    masterKey.fill(0);
    w.service.close();
    w.db.close();
  });

  test('staged destruction authenticates and active custody cannot be discarded', async () => {
    const w = world();
    const masterKey = randomBytes(32);
    await w.service.provision({ albumId: 'STAGED', password: PASSWORD, masterKey, metadata: metadata('Staged') });
    assert.equal(await w.service.discardStaged('STAGED', 'wrong password'), false);
    assert.equal(await w.service.discardStaged('STAGED', PASSWORD), true);
    assert.equal(w.repository.get('STAGED'), undefined);

    await w.service.provision({ albumId: 'ACTIVE', password: PASSWORD, masterKey, metadata: metadata('Active') });
    assert.equal(w.repository.transition('ACTIVE', 'staged', 'active', '2026-07-16T01:00:00.000Z'), true);
    assert.equal(w.repository.transition('ACTIVE', 'staged', 'retiring'), false);
    assert.equal(await w.service.discardStaged('ACTIVE', PASSWORD), false);
    assert.equal(w.repository.deleteStaged('ACTIVE'), false);
    assert.equal(w.repository.get('ACTIVE')?.migrationState, 'active');

    masterKey.fill(0);
    w.service.close();
    w.db.close();
  });
});
