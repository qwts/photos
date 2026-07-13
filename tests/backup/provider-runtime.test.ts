import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProviderRuntime, type ProviderRuntimeOptions } from '../../src/main/backup/provider-runtime.js';
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
  });

  test('connect wires the handshake to custody + providerId flip', async () => {
    let flipped: string | null = null;
    let opened: string | null = null;
    const { runtime: r } = runtime({
      openExternal: (url) => {
        opened = url;
        // Abandon the flow — the loopback machinery has its own tests; here
        // only the wiring matters.
        throw new Error('browser stub stops here');
      },
      setProviderId: (id) => {
        flipped = id;
      },
    });
    const result = await r.connect();
    assert.equal(result.ok, false);
    assert.match(opened ?? '', /my\.pcloud\.com\/oauth2\/authorize/u, 'the system browser gets the authorize URL');
    assert.equal(flipped, null, 'providerId never flips on a failed handshake');
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
