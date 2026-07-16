import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { describe, test } from 'node:test';

import { importImageTrailCompatibilityFile } from '../../src/main/interop/image-trail-compat.js';

const CREATED_AT = '2026-07-16T14:00:00.000Z';
const BOOKMARK = {
  uuid: 'bookmark-legacy-1',
  payload: {
    url: 'https://example.test/photo.jpg',
    title: 'Reference',
    label: 'Blue',
    thumbnail: 'data:image/jpeg;base64,AQID',
    width: 1200,
    height: 800,
    bookmarkedAt: '2026-07-16T13:00:00.000Z',
    capturedAt: '2026-07-16T13:05:00.000Z',
    sourceCompatibility: 'favorites',
    storedOriginal: {
      blobId: 'original-1',
      mimeType: 'image/jpeg',
      byteLength: 42,
      capturedAt: '2026-07-16T13:05:00.000Z',
    },
    protectedPin: {
      schemaVersion: 1,
      plainPinId: 'bookmark-legacy-1',
      queueUpdatedAt: '2026-07-16T13:06:00.000Z',
      hasEncryptedMetadata: true,
      hasEncryptedThumbnail: true,
      hasStoredOriginal: true,
    },
    futureImageTrailField: { retained: true },
  },
} as const;

function plainExport(entries: readonly unknown[] = [BOOKMARK]): string {
  return JSON.stringify({
    format: 'image-trail.records',
    formatVersion: 1,
    payloadType: 'bookmarks',
    createdAt: CREATED_AT,
    recordCount: entries.length,
    entries,
  });
}

async function encryptedExport(password: string): Promise<string> {
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await webcrypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
  passwordBytes.fill(0);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const plaintext = new TextEncoder().encode(JSON.stringify([BOOKMARK]));
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  plaintext.fill(0);
  return JSON.stringify({
    header: {
      magic: 'IMAGE-TRAIL-EXPORT',
      formatVersion: 1,
      payloadType: 'bookmarks',
      algorithm: 'AES-GCM',
      wrappingMode: 'password',
      keyKind: 'export',
      keyReference: 'export:fixture',
      salt: Buffer.from(salt).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      iterations: 600_000,
      createdAt: CREATED_AT,
      recordCount: 1,
    },
    payload: Buffer.from(ciphertext).toString('base64'),
  });
}

describe('Image Trail compatibility import', () => {
  test('parses plaintext bookmark exports per row and retains unknown metadata', async () => {
    const result = await importImageTrailCompatibilityFile(plainExport([BOOKMARK, { uuid: 'bad', payload: { url: 4 } }]));

    assert.equal(result.plaintext, true);
    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.skipped, ['bad']);
    assert.deepEqual(result.entries[0], BOOKMARK);
    assert.equal(result.albums.length, 0);
  });

  test('decrypts password exports without weakening the Image Trail cryptographic parameters', async () => {
    const result = await importImageTrailCompatibilityFile(await encryptedExport('correct horse'), 'correct horse');
    assert.equal(result.plaintext, false);
    assert.deepEqual(result.entries, [BOOKMARK]);
  });

  test('uses one generic failure for a wrong password, corrupt ciphertext, or malformed header', async () => {
    const encrypted = await encryptedExport('correct horse');
    await assert.rejects(
      importImageTrailCompatibilityFile(encrypted, 'wrong horse'),
      /Wrong password, corrupt file, or unsupported export/u,
    );

    const weak = JSON.parse(encrypted) as { header: { iterations: number } };
    weak.header.iterations = 1;
    await assert.rejects(
      importImageTrailCompatibilityFile(JSON.stringify(weak), 'correct horse'),
      /Wrong password, corrupt file, or unsupported export/u,
    );
  });

  test('rejects count mismatches and non-bookmark plaintext payloads', async () => {
    const mismatch = JSON.parse(plainExport()) as { recordCount: number };
    mismatch.recordCount = 2;
    await assert.rejects(importImageTrailCompatibilityFile(JSON.stringify(mismatch)), /Invalid plain Image Trail export/u);

    const history = JSON.parse(plainExport()) as { payloadType: string };
    history.payloadType = 'history';
    await assert.rejects(importImageTrailCompatibilityFile(JSON.stringify(history)), /Invalid plain Image Trail export/u);
  });
});
