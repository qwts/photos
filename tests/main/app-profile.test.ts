import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { configureAppProfile } from '../../src/main/app-profile.js';
import { OVERLOOK_PRODUCT_NAME } from '../../src/shared/app-identity.js';

function profileApp(
  isPackaged = false,
  paths?: { readonly appData: string; readonly userData: string },
): {
  app: Parameters<typeof configureAppProfile>[0];
  calls: string[];
} {
  const calls: string[] = [];
  const defaults = paths ?? { appData: '/profiles', userData: '/profiles/photos' };
  return {
    app: {
      isPackaged,
      getPath: (name) => defaults[name],
      setName: (name) => calls.push(`name:${name}`),
      setPath: (name, value) => calls.push(`path:${name}:${value}`),
    },
    calls,
  };
}

describe('app profile identity', () => {
  it('sets the stable product name before an unpackaged profile override', () => {
    const { app, calls } = profileApp();

    assert.equal(configureAppProfile(app, '/tmp/overlook-profile'), '/tmp/overlook-profile');
    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`, 'path:userData:/tmp/overlook-profile']);
  });

  it('ignores profile overrides in packaged builds', () => {
    const { app, calls } = profileApp(true);

    assert.equal(configureAppProfile(app, '/tmp/overlook-profile'), undefined);
    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`, `path:userData:/profiles/${OVERLOOK_PRODUCT_NAME}`]);
  });

  it('reuses the established packaged profile containing the library registry and provider custody', () => {
    const appData = mkdtempSync(join(tmpdir(), 'overlook-app-profile-'));
    const stable = join(appData, OVERLOOK_PRODUCT_NAME);
    const initial = join(appData, 'com.zts1.overlook');
    mkdirSync(join(stable, 'provider-auth', 'pcloud'), { recursive: true });
    writeFileSync(join(stable, 'libraries.json'), '{"version":1,"entries":[]}');
    writeFileSync(join(stable, 'provider-auth', 'pcloud', 'pcloud-auth.bin'), 'sealed');
    const { app, calls } = profileApp(true, { appData, userData: initial });

    configureAppProfile(app, undefined);

    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`, `path:userData:${stable}`]);
  });

  it('preserves a populated packaged profile when the conventional path is empty', () => {
    const appData = mkdtempSync(join(tmpdir(), 'overlook-app-profile-current-'));
    const initial = join(appData, 'current-profile');
    mkdirSync(join(initial, 'library'), { recursive: true });
    writeFileSync(join(initial, 'library', 'library.db'), 'encrypted');
    const { app, calls } = profileApp(true, { appData, userData: initial });

    configureAppProfile(app, undefined);

    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`, `path:userData:${initial}`]);
  });

  it('recovers the pre-product-name photos profile in place', () => {
    const appData = mkdtempSync(join(tmpdir(), 'overlook-app-profile-legacy-'));
    const stable = join(appData, OVERLOOK_PRODUCT_NAME);
    const legacy = join(appData, 'photos');
    mkdirSync(join(legacy, 'library'), { recursive: true });
    mkdirSync(join(legacy, 'provider-auth', 'pcloud'), { recursive: true });
    writeFileSync(join(legacy, 'library', 'library.db'), 'encrypted');
    writeFileSync(join(legacy, 'provider-auth', 'pcloud', 'pcloud-auth.bin'), 'sealed');
    const { app, calls } = profileApp(true, { appData, userData: stable });

    configureAppProfile(app, undefined);

    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`, `path:userData:${legacy}`]);
  });

  it('keeps an established Overlook profile when a stale photos profile also exists', () => {
    const appData = mkdtempSync(join(tmpdir(), 'overlook-app-profile-both-'));
    const stable = join(appData, OVERLOOK_PRODUCT_NAME);
    const legacy = join(appData, 'photos');
    mkdirSync(stable, { recursive: true });
    mkdirSync(join(legacy, 'library'), { recursive: true });
    writeFileSync(join(stable, 'libraries.json'), '{"version":1,"entries":[]}');
    writeFileSync(join(legacy, 'library', 'library.db'), 'stale');
    const { app, calls } = profileApp(true, { appData, userData: stable });

    configureAppProfile(app, undefined);

    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`, `path:userData:${stable}`]);
  });
});
