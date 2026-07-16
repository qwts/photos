import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GoogleDrivePathStore } from '../../src/main/backup/google-drive/path-store.js';
import { GoogleDriveCustodyError, GoogleDriveTokenStore } from '../../src/main/backup/google-drive/token-store.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`sealed:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
  decryptString: (value) => Buffer.from(value.toString('utf8').replace(/^sealed:/u, ''), 'base64').toString('utf8'),
};

describe('Google Drive credential and path custody (#277)', () => {
  test('refresh tokens are sealed atomically, survive restart, and clear', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-google-auth-'));
    const store = new GoogleDriveTokenStore({ safeStorage, dataDir });
    const record = {
      clientId: 'desktop.apps.googleusercontent.com',
      refreshToken: 'refresh-secret',
      connectedAt: '2026-07-16T00:00:00.000Z',
    };
    store.save(record);
    const raw = readFileSync(join(dataDir, 'google-drive-auth.bin'), 'utf8');
    assert.match(raw, /^sealed:/u);
    assert.doesNotMatch(raw, /refresh-secret/u);
    assert.deepEqual(new GoogleDriveTokenStore({ safeStorage, dataDir }).load(), record);
    store.clear();
    assert.equal(existsSync(join(dataDir, 'google-drive-auth.bin')), false);
  });

  test('unavailable keychain and corrupt or malformed records fail closed', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-google-auth-bad-'));
    const unavailable = new GoogleDriveTokenStore({
      dataDir,
      safeStorage: { ...safeStorage, isEncryptionAvailable: () => false },
    });
    assert.throws(
      () => unavailable.save({ clientId: 'desktop.apps.googleusercontent.com', refreshToken: 'x', connectedAt: 'now' }),
      GoogleDriveCustodyError,
    );
    writeFileSync(join(dataDir, 'google-drive-auth.bin'), 'not-json');
    assert.equal(new GoogleDriveTokenStore({ safeStorage, dataDir }).load(), null);
    writeFileSync(
      join(dataDir, 'google-drive-auth.bin'),
      safeStorage.encryptString('{"clientId":"bad","refreshToken":"","connectedAt":2}'),
    );
    assert.equal(new GoogleDriveTokenStore({ safeStorage, dataDir }).load(), null);
  });

  test('folder and file IDs persist independently and corrupt indexes reset safely', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-google-paths-'));
    const paths = new GoogleDrivePathStore(dataDir);
    paths.setOverlookFolderId('root-id');
    paths.setFolderId('LIB_1', '', 'library-id');
    paths.setFolderId('LIB_1', 'blobs/aa', 'folder-id');
    paths.setFileId('LIB_1', 'blobs/aa/hash', 'file-id');

    const restarted = new GoogleDrivePathStore(dataDir);
    assert.equal(restarted.overlookFolderId(), 'root-id');
    assert.equal(restarted.folderId('LIB_1', ''), 'library-id');
    assert.equal(restarted.folderId('LIB_1', 'blobs/aa'), 'folder-id');
    assert.equal(restarted.fileId('LIB_1', 'blobs/aa/hash'), 'file-id');
    restarted.setFolderId('LIB_1', 'blobs/aa', null);
    restarted.setFileId('LIB_1', 'blobs/aa/hash', null);
    assert.equal(new GoogleDrivePathStore(dataDir).folderId('LIB_1', 'blobs/aa'), null);
    assert.equal(new GoogleDrivePathStore(dataDir).fileId('LIB_1', 'blobs/aa/hash'), null);

    writeFileSync(join(dataDir, 'google-drive-paths.json'), '{"version":1,"overlookFolderId":3,"libraries":{}}');
    assert.equal(new GoogleDrivePathStore(dataDir).overlookFolderId(), null);
    writeFileSync(join(dataDir, 'google-drive-paths.json'), 'broken');
    assert.equal(new GoogleDrivePathStore(dataDir).folderId('LIB_1', ''), null);
  });
});
