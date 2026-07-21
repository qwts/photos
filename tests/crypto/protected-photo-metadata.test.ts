import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  openProtectedPhotoMetadata,
  ProtectedPhotoMetadataError,
  sealProtectedPhotoMetadata,
  type ProtectedPhotoMetadata,
} from '../../src/main/crypto/protected-photo-metadata.js';

const context = { libraryId: 'library-a', albumId: 'album-a', photoId: 'photo-a' };
const metadata: ProtectedPhotoMetadata = {
  version: 1,
  photo: {
    id: 'photo-a',
    fileName: 'secret.jpg',
    fileKind: 'jpeg',
    mediaInfo: null,
    width: 4000,
    height: 3000,
    bytes: 10,
    contentHash: 'a'.repeat(64),
    camera: 'camera',
    lens: null,
    iso: 100,
    aperture: '2.8',
    shutter: '1/250',
    focalLength: 35,
    takenAt: '2026-07-16T12:00:00.000Z',
    gpsLat: 1,
    gpsLon: 2,
    place: 'private place',
    importedAt: '2026-07-16T12:00:00.000Z',
    importSource: 'camera',
    favorite: true,
    deletedAt: null,
  },
  ordinaryMemberships: [{ albumId: 'ordinary-a', position: 3 }],
};

describe('protected photo metadata', () => {
  test('round-trips searchable fields and ordinary memberships only with album authority', () => {
    const albumKey = randomBytes(32);
    const sealed = sealProtectedPhotoMetadata(context, albumKey, metadata);
    assert.equal(sealed.includes(Buffer.from('private place')), false);
    assert.deepEqual(openProtectedPhotoMetadata(context, albumKey, sealed), metadata);
    assert.throws(() => openProtectedPhotoMetadata({ ...context, albumId: 'album-b' }, albumKey, sealed), ProtectedPhotoMetadataError);
    assert.throws(() => openProtectedPhotoMetadata(context, randomBytes(32), sealed), ProtectedPhotoMetadataError);
  });

  test('binds the photo id and rejects tampering', () => {
    const albumKey = randomBytes(32);
    const sealed = sealProtectedPhotoMetadata(context, albumKey, metadata);
    assert.throws(() => openProtectedPhotoMetadata({ ...context, photoId: 'photo-b' }, albumKey, sealed), ProtectedPhotoMetadataError);
    sealed[sealed.length - 1] = (sealed.at(-1) ?? 0) ^ 1;
    assert.throws(() => openProtectedPhotoMetadata(context, albumKey, sealed), ProtectedPhotoMetadataError);
  });
});
