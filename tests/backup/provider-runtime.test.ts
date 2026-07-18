import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProviderRuntime, type ProviderRuntimeOptions } from '../../src/main/backup/provider-runtime.js';
import { GoogleDrivePathStore } from '../../src/main/backup/google-drive/path-store.js';
import { PCloudTokenStore } from '../../src/main/backup/pcloud/token-store.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

// #256: provider-selection policy — packaged vs dev targets, the stale-mock
// correction, and the persistent library id.

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(plainText, 'utf8'),
  decryptString: (encrypted) => encrypted.toString('utf8'),
};

function runtime(overrides: Partial<ProviderRuntimeOptions> = {}) {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'overlook-runtime-')), 'library');
  return {
    dataDir,
    runtime: new ProviderRuntime({
      dataDir: () => dataDir,
      safeStorage: () => fakeSafeStorage,
      openExternal: () => Promise.resolve(),
      setProviderId: () => undefined,
      providerId: () => null,
      isPackaged: false,
      harnessEnv: () => undefined,
      ...overrides,
    }),
  };
}

describe('provider runtime policy (#256)', () => {
  test('libraryId mints one ULID and persists it — restarts reuse the same remote home', () => {
    const { runtime: r, dataDir } = runtime();
    const first = r.libraryId();
    assert.match(first, /^[0-9A-HJKMNP-TV-Z]{26}$/u, 'Crockford ULID shape');
    assert.equal(r.libraryId(), first);
    assert.equal(readFileSync(join(dataDir, 'library-id'), 'utf8').trim(), first);
    assert.equal(
      new ProviderRuntime({ ...baseOptions(), dataDir: () => dataDir }).libraryId(),
      first,
      'a fresh instance (restart) reads the same id',
    );
  });

  test('a corrupted library-id record is replaced, never used as a remote home (PR #260 review)', () => {
    const { runtime: r, dataDir } = runtime();
    const original = r.libraryId();
    for (const bad of ['', 'short', `${original}\nTRAILING-JUNK-MAKING-IT-LONG`, 'lowercase0123456789abcdef0']) {
      writeFileSync(join(dataDir, 'library-id'), bad);
      const replacement = r.libraryId();
      assert.match(replacement, /^[0-9A-HJKMNP-TV-Z]{26}$/u);
      assert.equal(readFileSync(join(dataDir, 'library-id'), 'utf8').trim(), replacement, 'the fresh id is persisted');
    }
  });

  test('defaultTarget: dev → mock, packaged → pcloud, harness override wins in dev', () => {
    assert.equal(runtime().runtime.defaultTarget(), 'mock');
    assert.equal(runtime({ isPackaged: true }).runtime.defaultTarget(), 'pcloud');
    assert.equal(
      runtime({ harnessEnv: (name) => (name === 'OVERLOOK_PROVIDER' ? 'pcloud' : undefined) }).runtime.defaultTarget(),
      'pcloud',
    );
    assert.equal(runtime({ harnessEnv: () => 'garbage' }).runtime.defaultTarget(), 'mock');
    assert.equal(
      runtime({
        harnessEnv: (name) => (name === 'OVERLOOK_PROVIDER' ? 'google-drive' : undefined),
        googleDriveClientId: () => 'desktop.apps.googleusercontent.com',
      }).runtime.defaultTarget(),
      'google-drive',
    );
  });

  test("activeId: packaged corrects a stale/default 'mock' to disconnected; dev passes it through", () => {
    assert.equal(runtime({ providerId: () => 'mock', isPackaged: true }).runtime.activeId(), null);
    assert.equal(runtime({ providerId: () => 'mock' }).runtime.activeId(), 'mock');
    assert.equal(runtime({ providerId: () => 'pcloud', isPackaged: true }).runtime.activeId(), 'pcloud');
    assert.equal(runtime({ providerId: () => 'google-drive' }).runtime.activeId(), null, 'an unconfigured Drive build is disconnected');
    assert.equal(
      runtime({ providerId: () => 'google-drive', googleDriveClientId: () => 'desktop.apps.googleusercontent.com' }).runtime.activeId(),
      'google-drive',
    );
    assert.equal(runtime({ providerId: () => null }).runtime.activeId(), null);
    const { runtime: unavailable } = runtime({ providerId: () => 'missing-provider' });
    unavailable.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });
    assert.equal(unavailable.activeId(), null, 'an unavailable id never falls through to another remote authority');
  });

  test('provider-addressed connect flips selection only after success', async () => {
    let flipped: string | null = null;
    const { runtime: r } = runtime({
      setProviderId: (id) => {
        flipped = id;
      },
    });
    r.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });
    assert.equal((await r.connect('missing-provider')).ok, false);
    assert.equal(flipped, null, 'an unavailable provider never changes remote authority');
    assert.equal((await r.connect('mock')).ok, true);
    assert.equal(flipped, 'mock');
  });

  test('pCloud disconnect verifies custody and persisted selection before reporting success', async () => {
    let providerId: string | null = 'pcloud';
    const { runtime: r } = runtime({
      providerId: () => providerId,
      setProviderId: (id) => {
        providerId = id;
      },
    });
    const record = {
      accessToken: 'disconnect-token',
      apiHost: 'api.pcloud.com',
      connectedAt: '2026-07-18T00:00:00.000Z',
    } as const;
    r.tokenStore().save(record);
    r.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });

    assert.deepEqual(await Promise.resolve(r.disconnect('pcloud')), { ok: true, reason: null });
    assert.equal(r.tokenStore().load(), null);
    assert.equal(providerId, null);
  });

  test('pCloud disconnect restores custody when provider selection does not persist', async () => {
    const { runtime: r } = runtime({
      providerId: () => 'pcloud',
      setProviderId: () => undefined,
    });
    const record = {
      accessToken: 'rollback-token',
      apiHost: 'eapi.pcloud.com',
      connectedAt: '2026-07-18T00:00:00.000Z',
    } as const;
    r.tokenStore().save(record);
    r.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });

    const result = await Promise.resolve(r.disconnect('pcloud'));
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /save the disconnected state/u);
    assert.deepEqual(r.tokenStore().load(), record, 'a failed settings write cannot silently discard working credentials');
  });

  test('pCloud disconnect reports credential-removal failure without changing provider selection', async () => {
    let providerId: string | null = 'pcloud';
    const { runtime: r } = runtime({
      providerId: () => providerId,
      setProviderId: (id) => {
        providerId = id;
      },
    });
    const store = r.tokenStore();
    store.save({
      accessToken: 'retained-token',
      apiHost: 'api.pcloud.com',
      connectedAt: '2026-07-18T00:00:00.000Z',
    });
    store.clear = () => {
      throw new Error('injected custody failure');
    };
    r.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });

    const result = await Promise.resolve(r.disconnect('pcloud'));
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /remove the pCloud authorization/u);
    assert.equal(providerId, 'pcloud');
  });

  test('concurrent pCloud disconnect requests share one transaction', async () => {
    let providerId: string | null = 'pcloud';
    const { runtime: r } = runtime({
      providerId: () => providerId,
      setProviderId: (id) => {
        providerId = id;
      },
    });
    r.tokenStore().save({
      accessToken: 'single-flight-token',
      apiHost: 'api.pcloud.com',
      connectedAt: '2026-07-18T00:00:00.000Z',
    });
    r.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });

    const first = r.disconnect('pcloud');
    const repeated = r.disconnect('pcloud');
    assert.equal(repeated, first);
    await Promise.resolve(first);
  });

  test('descriptors expose capabilities and switching is blocked during active work', async () => {
    let active = true;
    const { runtime: r } = runtime({ isWorkActive: () => active });
    r.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });
    assert.deepEqual(
      r.descriptors().map(({ id, capabilities }) => ({ id, quota: capabilities.quota })),
      [
        { id: 'pcloud', quota: 'known' },
        { id: 'google-drive', quota: 'known' },
        { id: 'mock', quota: 'known' },
      ],
    );
    const drive = r.descriptors().find(({ id }) => id === 'google-drive');
    assert.deepEqual(
      { available: drive?.available, reason: drive?.unavailableReason },
      { available: false, reason: 'Google Drive OAuth is not configured in this build.' },
    );
    assert.equal((await r.connect('google-drive')).ok, false);
    assert.equal((await r.connect('mock')).ok, false);
    assert.equal((await r.disconnect('mock')).ok, false);
    active = false;
    assert.equal((await r.connect('mock')).ok, true);
  });

  test('pCloud custody migrates out of the replaceable library directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-runtime-custody-'));
    const dataDir = join(root, 'library');
    const credentialDir = join(root, 'provider-auth', 'pcloud');
    const record = {
      accessToken: 'legacy-token',
      apiHost: 'api.pcloud.com',
      connectedAt: '2026-07-14T00:00:00.000Z',
    } as const;
    new PCloudTokenStore({ safeStorage: fakeSafeStorage, dataDir }).save(record);

    const { runtime: r } = runtime({ dataDir: () => dataDir, credentialDir: () => credentialDir });

    assert.deepEqual(r.tokenStore().load(), record);
    assert.equal(existsSync(join(credentialDir, 'pcloud-auth.bin')), true);
    assert.equal(existsSync(join(dataDir, 'pcloud-auth.bin')), false, 'legacy token is removed after migration');
  });

  test('provider-specific custody directories keep Google refresh tokens outside the library', async () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-runtime-google-custody-'));
    const { runtime: r } = runtime({
      dataDir: () => join(root, 'library'),
      providerCredentialDir: (id) => join(root, 'provider-auth', id),
      googleDriveClientId: () => 'desktop.apps.googleusercontent.com',
    });
    r.googleTokenStore().save({
      clientId: 'desktop.apps.googleusercontent.com',
      refreshToken: 'refresh-1',
      connectedAt: '2026-07-16T00:00:00.000Z',
    });
    const driveCredentialDir = join(root, 'provider-auth', 'google-drive');
    const paths = new GoogleDrivePathStore(driveCredentialDir);
    paths.setOverlookFolderId('old-account-root');
    paths.setFolderId('LIB_1', '', 'old-account-library');
    assert.equal(existsSync(join(root, 'provider-auth', 'google-drive', 'google-drive-auth.bin')), true);
    r.buildProvider({ mockRootDir: join(root, 'mock'), fault: undefined });
    assert.equal(r.descriptors().find(({ id }) => id === 'google-drive')?.available, true);
    assert.equal((await r.disconnect('google-drive')).ok, true);
    assert.equal(r.googleTokenStore().load(), null);
    const cleared = new GoogleDrivePathStore(driveCredentialDir);
    assert.equal(cleared.overlookFolderId(), null);
    assert.equal(cleared.folderId('LIB_1', ''), null);
  });

  test('library activation drops provider instances bound to the previous remote home', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-runtime-library-rebind-'));
    let dataDir = join(root, 'library-a');
    const { runtime: r } = runtime({ dataDir: () => dataDir, providerCredentialDir: (id) => join(root, 'provider-auth', id) });
    r.buildProvider({ mockRootDir: join(root, 'mock'), fault: undefined });
    const previousMock = r.provider('mock');
    const previousPCloudTokenStore = r.tokenStore();
    const firstLibraryId = r.libraryId();

    dataDir = join(root, 'library-b');
    r.resetLibraryBinding();
    assert.equal(r.provider('mock'), undefined, 'status/data IPC cannot reuse a provider scoped to library A');
    assert.deepEqual(r.descriptors(), []);

    r.buildProvider({ mockRootDir: join(root, 'mock'), fault: undefined });
    assert.notEqual(r.provider('mock'), previousMock);
    assert.notEqual(r.libraryId(), firstLibraryId, 'the rebuilt registry targets library B remote paths');
    assert.equal(r.tokenStore(), previousPCloudTokenStore, 'profile credential custody intentionally survives the switch');
  });
});

/** Options for a second instance against the same dataDir (restart shape). */
function baseOptions(): Omit<ProviderRuntimeOptions, 'dataDir'> {
  return {
    safeStorage: () => fakeSafeStorage,
    openExternal: () => Promise.resolve(),
    setProviderId: () => undefined,
    providerId: () => null,
    isPackaged: false,
    harnessEnv: () => undefined,
  };
}
