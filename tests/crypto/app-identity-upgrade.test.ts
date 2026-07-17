import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { describe, test } from 'node:test';

import { BlobStore } from '../../src/main/blobs/blob-store.js';
import { GoogleDriveTokenStore, type GoogleDriveAuthRecord } from '../../src/main/backup/google-drive/token-store.js';
import { PCloudTokenStore, type PCloudAuthRecord } from '../../src/main/backup/pcloud/token-store.js';
import { AppLockCredentialStore, type CredentialAnchor, type CredentialAnchorStore } from '../../src/main/crypto/app-lock-credentials.js';
import { KeyStore, type SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { openRecoveryKey, sealRecoveryKey } from '../../src/main/crypto/recovery.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { queryAll } from '../../src/main/db/sql.js';
import { seedLibrary } from '../../src/main/library/seed.js';
import { ScopedSettingsStore } from '../../src/main/settings/scoped-settings-store.js';
import { defaultSettings } from '../../src/shared/settings/settings.js';

const LIBRARY_ID = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
const APP_PASSWORD = 'identity upgrade password';
const RECOVERY_PASSWORD = 'identity recovery password';

function safeStorage(): SafeStorageLike {
  const pad = 0x5a;
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ pad)),
    decryptString: (value) => Buffer.from(value.map((byte) => byte ^ pad)).toString('utf8'),
  };
}

class MemoryAnchor implements CredentialAnchorStore {
  value: CredentialAnchor | null = null;

  isAvailable(): boolean {
    return true;
  }

  read(): CredentialAnchor | null {
    return this.value === null ? null : { ...this.value };
  }

  write(anchor: CredentialAnchor): void {
    this.value = { ...anchor };
  }

  clear(): void {
    this.value = null;
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('macOS app-identity upgrade custody (#374)', () => {
  test('legacy profile reopens in place without changing library, ciphertext, settings, provider tokens, or recovery', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'overlook-identity-upgrade-'));
    const dataDir = join(userData, 'library');
    const storage = safeStorage();
    const keys = KeyStore.open({ safeStorage: storage, dataDir });
    const masterKey = keys.masterKeyBytes();
    const dbKey = keys.resolver()(1);
    assert.ok(dbKey !== undefined);
    const db = openLibraryDatabase({ path: join(dataDir, 'library.db'), dbKey });
    const blobs = new BlobStore({ dataDir });
    await blobs.init();
    await seedLibrary(db, blobs, keys.currentKey(), 8);

    const settingsPath = join(userData, 'settings.json');
    const expectedSettings = { ...defaultSettings, providerId: 'pcloud', sortOrder: 'name', lockWhenHidden: true } as const;
    writeFileSync(settingsPath, JSON.stringify(expectedSettings), 'utf8');
    writeFileSync(join(dataDir, 'library-id'), LIBRARY_ID);

    const pcloud: PCloudAuthRecord = {
      accessToken: 'sealed-pcloud-fixture',
      apiHost: 'api.pcloud.com',
      connectedAt: '2026-07-16T00:00:00.000Z',
    };
    const google: GoogleDriveAuthRecord = {
      clientId: 'fixture.apps.googleusercontent.com',
      refreshToken: 'sealed-google-fixture',
      connectedAt: '2026-07-16T00:00:00.000Z',
    };
    const pcloudDir = join(userData, 'provider-auth', 'pcloud');
    const googleDir = join(userData, 'provider-auth', 'google-drive');
    new PCloudTokenStore({ safeStorage: storage, dataDir: pcloudDir }).save(pcloud);
    new GoogleDriveTokenStore({ safeStorage: storage, dataDir: googleDir }).save(google);

    const recovery = sealRecoveryKey(masterKey, RECOVERY_PASSWORD);
    const anchor = new MemoryAnchor();
    const appLock = new AppLockCredentialStore({ dataDir, anchorStore: anchor, safeStorage: storage });
    await appLock.configure({ libraryId: LIBRARY_ID, password: APP_PASSWORD, masterKey });

    const photo = new PhotosRepository(db).page({ source: 'all', limit: 1 }).photos[0];
    assert.ok(photo !== undefined);
    const originalPath = join(dataDir, 'blobs', photo.contentHash.slice(0, 2), photo.contentHash.slice(2, 4), photo.contentHash);
    const immutableBefore = {
      original: sha256(originalPath),
      appLock: sha256(join(dataDir, 'master.key')),
      pcloud: sha256(join(pcloudDir, 'pcloud-auth.bin')),
      google: sha256(join(googleDir, 'google-drive-auth.bin')),
    };
    db.close();
    keys.close();
    masterKey.fill(0);

    const upgradedLock = new AppLockCredentialStore({ dataDir, anchorStore: anchor, safeStorage: storage });
    assert.deepEqual(upgradedLock.status(), { state: 'locked', libraryId: LIBRARY_ID });
    const unlocked = await upgradedLock.unlock(APP_PASSWORD);
    assert.equal(unlocked.ok, true);
    if (!unlocked.ok) return;
    const recoveredMaster = openRecoveryKey(recovery, RECOVERY_PASSWORD);
    assert.deepEqual(recoveredMaster, unlocked.masterKey);
    recoveredMaster.fill(0);

    const upgradedKeys = KeyStore.openWithMaster({ safeStorage: storage, dataDir }, unlocked.masterKey);
    const upgradedDbKey = upgradedKeys.resolver()(1);
    assert.ok(upgradedDbKey !== undefined);
    const upgradedDb = openLibraryDatabase({ path: join(dataDir, 'library.db'), dbKey: upgradedDbKey });
    const upgradedRepo = new PhotosRepository(upgradedDb);
    assert.equal(upgradedRepo.stats().photos, 8);
    assert.equal(queryAll<{ count: number }>(upgradedDb, 'SELECT count(*) AS count FROM albums')[0]?.count, 4);
    assert.deepEqual(
      new ScopedSettingsStore({ profileFilePath: settingsPath, libraryFilePath: () => join(dataDir, 'settings.json') }).get(),
      expectedSettings,
    );
    assert.equal(readFileSync(join(dataDir, 'library-id'), 'utf8'), LIBRARY_ID);
    assert.deepEqual(new PCloudTokenStore({ safeStorage: storage, dataDir: pcloudDir }).load(), pcloud);
    assert.deepEqual(new GoogleDriveTokenStore({ safeStorage: storage, dataDir: googleDir }).load(), google);
    assert.deepEqual(
      {
        original: sha256(originalPath),
        appLock: sha256(join(dataDir, 'master.key')),
        pcloud: sha256(join(pcloudDir, 'pcloud-auth.bin')),
        google: sha256(join(googleDir, 'google-drive-auth.bin')),
      },
      immutableBefore,
    );

    const upgradedBlobs = new BlobStore({ dataDir });
    await upgradedBlobs.init();
    const plaintext = await buffer(upgradedBlobs.getStream(photo.contentHash, upgradedKeys.resolver(), photo.id));
    assert.deepEqual([plaintext[0], plaintext[1]], [0xff, 0xd8]);

    upgradedDb.close();
    upgradedKeys.close();
    unlocked.masterKey.fill(0);
  });
});
