import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  changeProtectedAlbumPassword,
  createProtectedAlbumCustody,
  inspectProtectedAlbumCredentialRecord,
  ProtectedAlbumCredentialError,
  recoverProtectedAlbumPassword,
  unlockProtectedAlbumCustody,
  type ProtectedAlbumMetadata,
} from '../../src/main/crypto/protected-album-credentials.js';
import { sealRecoveryKey } from '../../src/main/crypto/recovery.js';

const CONTEXT = { libraryId: 'LIBRARY1', albumId: 'ALBUM1' } as const;
const PASSWORD = 'correct horse battery staple';
const NEXT_PASSWORD = 'an entirely different strong phrase';
const RECOVERED_PASSWORD = 'recovered with another strong phrase';

function metadata(name = 'Family'): ProtectedAlbumMetadata {
  return {
    version: 1,
    name,
    createdAt: '2026-07-16T00:00:00.000Z',
    position: 2,
    members: [
      {
        photoId: 'PHOTO1',
        position: 0,
        ordinaryMemberships: [
          { albumId: 'TRAVEL', position: 3 },
          { albumId: 'FAVORITES', position: 9 },
        ],
      },
    ],
  };
}

function reason(expected: ProtectedAlbumCredentialFailure): (error: unknown) => boolean {
  return (error) => error instanceof ProtectedAlbumCredentialError && error.reason === expected;
}

type ProtectedAlbumCredentialFailure = ProtectedAlbumCredentialError['reason'];

describe('protected album credentials (#325, ADR-0013)', () => {
  test('withholds the album key and sealed metadata behind independent password and recovery slots', async () => {
    const masterKey = randomBytes(32);
    const inputMetadata = metadata();
    const custody = await createProtectedAlbumCustody({ ...CONTEXT, password: PASSWORD, masterKey, metadata: inputMetadata });
    try {
      assert.equal(custody.credentialRecord.includes(Buffer.from(PASSWORD)), false);
      assert.equal(custody.credentialRecord.includes(masterKey), false);
      assert.equal(custody.credentialRecord.includes(custody.albumKey), false);
      assert.equal(custody.sealedMetadata.includes(Buffer.from(inputMetadata.name)), false);
      assert.equal(custody.sealedMetadata.includes(Buffer.from('PHOTO1')), false);

      await assert.rejects(
        unlockProtectedAlbumCustody(CONTEXT, custody.credentialRecord, custody.sealedMetadata, 'wrong password'),
        reason('wrong-password'),
      );
      const unlocked = await unlockProtectedAlbumCustody(CONTEXT, custody.credentialRecord, custody.sealedMetadata, PASSWORD);
      assert.deepEqual(unlocked.albumKey, custody.albumKey);
      assert.deepEqual(unlocked.metadata, inputMetadata);
      unlocked.albumKey.fill(0);
    } finally {
      custody.albumKey.fill(0);
      masterKey.fill(0);
    }
  });

  test('password rotation preserves the album key and recovery slot while revoking the old password', async () => {
    const masterKey = randomBytes(32);
    const custody = await createProtectedAlbumCustody({ ...CONTEXT, password: PASSWORD, masterKey, metadata: metadata() });
    const changed = await changeProtectedAlbumPassword(CONTEXT, custody.credentialRecord, custody.sealedMetadata, PASSWORD, NEXT_PASSWORD);
    try {
      assert.deepEqual(changed.albumKey, custody.albumKey);
      assert.deepEqual(inspectProtectedAlbumCredentialRecord(CONTEXT, changed.credentialRecord), {
        passwordGeneration: 2,
        metadataGeneration: 1,
      });
      await assert.rejects(
        unlockProtectedAlbumCustody(CONTEXT, changed.credentialRecord, custody.sealedMetadata, PASSWORD),
        reason('wrong-password'),
      );
      const unlocked = await unlockProtectedAlbumCustody(CONTEXT, changed.credentialRecord, custody.sealedMetadata, NEXT_PASSWORD);
      unlocked.albumKey.fill(0);

      const recoveryFile = sealRecoveryKey(masterKey, 'separately saved recovery password');
      const recovered = await recoverProtectedAlbumPassword(
        CONTEXT,
        changed.credentialRecord,
        custody.sealedMetadata,
        recoveryFile,
        'separately saved recovery password',
        RECOVERED_PASSWORD,
      );
      try {
        assert.deepEqual(recovered.albumKey, custody.albumKey);
        assert.equal(inspectProtectedAlbumCredentialRecord(CONTEXT, recovered.credentialRecord).passwordGeneration, 3);
        await assert.rejects(
          unlockProtectedAlbumCustody(CONTEXT, recovered.credentialRecord, custody.sealedMetadata, NEXT_PASSWORD),
          reason('wrong-password'),
        );
        const afterRecovery = await unlockProtectedAlbumCustody(
          CONTEXT,
          recovered.credentialRecord,
          custody.sealedMetadata,
          RECOVERED_PASSWORD,
        );
        afterRecovery.albumKey.fill(0);
      } finally {
        recovered.albumKey.fill(0);
      }
    } finally {
      changed.albumKey.fill(0);
      custody.albumKey.fill(0);
      masterKey.fill(0);
    }
  });

  test('cross-library, cross-album, downgrade, metadata substitution, and bad recovery fail closed', async () => {
    const masterKey = randomBytes(32);
    const first = await createProtectedAlbumCustody({ ...CONTEXT, password: PASSWORD, masterKey, metadata: metadata('First') });
    const secondContext = { libraryId: CONTEXT.libraryId, albumId: 'ALBUM2' };
    const second = await createProtectedAlbumCustody({
      ...secondContext,
      password: PASSWORD,
      masterKey,
      metadata: metadata('Second'),
    });
    try {
      assert.throws(
        () => inspectProtectedAlbumCredentialRecord({ libraryId: 'OTHER', albumId: CONTEXT.albumId }, first.credentialRecord),
        reason('invalid-record'),
      );
      assert.throws(
        () => inspectProtectedAlbumCredentialRecord({ ...CONTEXT, albumId: 'OTHER' }, first.credentialRecord),
        reason('invalid-record'),
      );
      const downgraded = Buffer.from(first.credentialRecord.toString('utf8').replace('"version":1', '"version":0'), 'utf8');
      assert.throws(() => inspectProtectedAlbumCredentialRecord(CONTEXT, downgraded), reason('invalid-record'));
      await assert.rejects(
        unlockProtectedAlbumCustody(CONTEXT, first.credentialRecord, second.sealedMetadata, PASSWORD),
        reason('invalid-record'),
      );
      await assert.rejects(
        recoverProtectedAlbumPassword(
          CONTEXT,
          first.credentialRecord,
          first.sealedMetadata,
          sealRecoveryKey(randomBytes(32), 'recovery password'),
          'recovery password',
          NEXT_PASSWORD,
        ),
        reason('wrong-recovery-key'),
      );
    } finally {
      first.albumKey.fill(0);
      second.albumKey.fill(0);
      masterKey.fill(0);
    }
  });

  test('metadata validation rejects duplicate photos and restoration memberships', async () => {
    const masterKey = randomBytes(32);
    const duplicatePhoto = metadata();
    duplicatePhoto.members = [duplicatePhoto.members[0]!, duplicatePhoto.members[0]!];
    await assert.rejects(
      createProtectedAlbumCustody({ ...CONTEXT, password: PASSWORD, masterKey, metadata: duplicatePhoto }),
      /duplicate photo/,
    );

    const duplicateMembership = metadata();
    duplicateMembership.members[0]!.ordinaryMemberships = [
      { albumId: 'SAME', position: 0 },
      { albumId: 'SAME', position: 1 },
    ];
    await assert.rejects(
      createProtectedAlbumCustody({ ...CONTEXT, password: PASSWORD, masterKey, metadata: duplicateMembership }),
      /duplicate album/,
    );
    masterKey.fill(0);
  });
});
