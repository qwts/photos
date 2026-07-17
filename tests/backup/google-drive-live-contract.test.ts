import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GoogleDriveAuthClient } from '../../src/main/backup/google-drive/auth-client.js';
import { createGoogleDriveConnect } from '../../src/main/backup/google-drive/connect.js';
import { GoogleDriveProvider } from '../../src/main/backup/google-drive/google-drive-provider.js';
import { GoogleDrivePathStore } from '../../src/main/backup/google-drive/path-store.js';
import { GoogleDriveTokenStore } from '../../src/main/backup/google-drive/token-store.js';
import { ProviderError } from '../../src/main/backup/provider.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { ulid } from '../../src/main/import/ulid.js';
import { exerciseDisasterRecoveryContract } from './disaster-recovery-contract.js';
import { exerciseRestoreProviderContract } from './restore-provider-contract.js';

const LIVE = process.env['OVERLOOK_GOOGLE_DRIVE_LIVE'] === '1';

function ephemeralSafeStorage(): SafeStorageLike {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString: (value) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

test('LIVE Google Drive provider and fresh-profile disaster-recovery contracts (#277)', { skip: !LIVE, timeout: 10 * 60_000 }, async () => {
  const clientId = process.env['OVERLOOK_GOOGLE_DRIVE_CLIENT_ID']?.trim() ?? '';
  const clientSecret = process.env['OVERLOOK_GOOGLE_DRIVE_CLIENT_SECRET']?.trim() || null;
  assert.match(clientId, /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/u, 'set OVERLOOK_GOOGLE_DRIVE_CLIENT_ID');
  const authDir = mkdtempSync(join(tmpdir(), 'overlook-google-live-'));
  const tokenStore = new GoogleDriveTokenStore({ safeStorage: ephemeralSafeStorage(), dataDir: authDir });
  const auth = new GoogleDriveAuthClient({ clientId: () => clientId, clientSecret: () => clientSecret, tokenStore });
  const connect = createGoogleDriveConnect({
    clientId: () => clientId,
    clientSecret: () => clientSecret,
    tokenStore,
    authClient: auth,
    openExternal: (url) => {
      console.log('\n  ➜ Open this URL in your browser and approve Google Drive access:\n');
      console.log(`    ${url}\n`);
      return Promise.resolve();
    },
    onConnected: () => undefined,
  });
  try {
    assert.deepEqual(await connect(), { ok: true, reason: null });
    const libraryId = ulid();
    const provider = new GoogleDriveProvider({
      auth,
      paths: new GoogleDrivePathStore(authDir),
      libraryId,
    });
    console.log(`  • isolated scratch home: Overlook/${libraryId}\n`);
    await exerciseRestoreProviderContract(provider, libraryId);
    assert.deepEqual(await exerciseDisasterRecoveryContract(provider, libraryId), { generation: 1, photos: 2 });

    const payload = Buffer.from('OVLK-google-drive-live-contract');
    const path = 'blobs/live/provider-contract';
    try {
      assert.deepEqual(await provider.put(path, Readable.from([payload])), { bytes: payload.length });
      assert.deepEqual(await provider.list('blobs/live'), [{ path, bytes: payload.length }]);
      assert.equal((await provider.verify(path)).bytes, payload.length);
      const quota = await provider.quota();
      assert.ok(quota.usedBytes >= payload.length);
    } finally {
      await provider.delete(path);
    }
    await assert.rejects(provider.getStream(path), (error: unknown) => error instanceof ProviderError && error.kind === 'not-found');
    console.log('  ✓ live Google Drive provider + disaster-recovery contracts green\n');
  } finally {
    auth.clear();
    rmSync(authDir, { recursive: true, force: true });
  }
});
