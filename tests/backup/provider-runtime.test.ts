import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProviderRuntime, type ProviderRuntimeOptions } from '../../src/main/backup/provider-runtime.js';
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
  });

  test("activeId: packaged corrects a stale/default 'mock' to disconnected; dev passes it through", () => {
    assert.equal(runtime({ providerId: () => 'mock', isPackaged: true }).runtime.activeId(), null);
    assert.equal(runtime({ providerId: () => 'mock' }).runtime.activeId(), 'mock');
    assert.equal(runtime({ providerId: () => 'pcloud', isPackaged: true }).runtime.activeId(), 'pcloud');
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

  test('descriptors expose capabilities and switching is blocked during active work', async () => {
    let active = true;
    const { runtime: r } = runtime({ isWorkActive: () => active });
    r.buildProvider({ mockRootDir: join(tmpdir(), 'overlook-runtime-mock'), fault: undefined });
    assert.deepEqual(
      r.descriptors().map(({ id, capabilities }) => ({ id, quota: capabilities.quota })),
      [
        { id: 'pcloud', quota: 'known' },
        { id: 'mock', quota: 'known' },
      ],
    );
    assert.equal((await r.connect('mock')).ok, false);
    assert.equal(r.disconnect('mock').ok, false);
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
