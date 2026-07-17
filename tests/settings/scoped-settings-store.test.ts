import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ScopedSettingsStore } from '../../src/main/settings/scoped-settings-store.js';
import { defaultSettings } from '../../src/shared/settings/settings.js';

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'overlook-scoped-settings-'));
  const profileFilePath = join(root, 'settings.json');
  let library = join(root, 'library-a');
  const store = new ScopedSettingsStore({ profileFilePath, libraryFilePath: () => join(library, 'settings.json') });
  return {
    root,
    profileFilePath,
    store,
    switchTo(name: string) {
      library = join(root, name);
      store.activateLibrary();
    },
    librarySettings(name: string): unknown {
      return JSON.parse(readFileSync(join(root, name, 'settings.json'), 'utf8'));
    },
  };
}

describe('scoped settings store (#387, ADR-0017 §6)', () => {
  test('library settings and provider selection do not bleed across switches', () => {
    const h = harness();
    h.store.set({ sortOrder: 'name', providerId: 'pcloud', appLockIdle: '30', reOffloadAfterViewing: false });

    h.switchTo('library-b');
    assert.equal(h.store.get().sortOrder, defaultSettings.sortOrder);
    assert.equal(h.store.get().providerId, defaultSettings.providerId);
    assert.equal(h.store.get().appLockIdle, defaultSettings.appLockIdle);
    assert.equal(h.store.get().reOffloadAfterViewing, defaultSettings.reOffloadAfterViewing);
    h.store.set({ sortOrder: 'size', providerId: null });

    h.switchTo('library-a');
    assert.equal(h.store.get().sortOrder, 'name');
    assert.equal(h.store.get().providerId, 'pcloud');
    assert.equal(h.store.get().appLockIdle, '30');
    assert.equal(h.store.get().reOffloadAfterViewing, false);
    assert.deepEqual(h.librarySettings('library-b'), {
      sortOrder: 'size',
      thumbnailsOnImport: true,
      autoBackupOnImport: true,
      reOffloadAfterViewing: true,
      importMode: 'copy',
      wifiOnly: true,
      bandwidthLimit: 100,
      appLockIdle: '5',
      lockWhenHidden: false,
      providerId: null,
    });
  });

  test('profile settings follow the user while library settings remain isolated', () => {
    const h = harness();
    h.store.set({ appearance: 'light', shareDiagnostics: true, sortOrder: 'name' });
    h.switchTo('library-b');

    assert.equal(h.store.get().appearance, 'light');
    assert.equal(h.store.get().shareDiagnostics, true);
    assert.equal(h.store.get().diagnosticsConsentVersion, 1);
    assert.equal(h.store.get().sortOrder, 'date');
  });

  test('legacy combined settings migrate once into the active library', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlook-scoped-settings-migration-'));
    const profileFilePath = join(root, 'settings.json');
    writeFileSync(
      profileFilePath,
      JSON.stringify({ ...defaultSettings, appearance: 'light', sortOrder: 'size', providerId: 'pcloud' }),
      'utf8',
    );
    let library = join(root, 'legacy-library');
    const store = new ScopedSettingsStore({ profileFilePath, libraryFilePath: () => join(library, 'settings.json') });

    assert.equal(store.get().appearance, 'light');
    assert.equal(store.get().sortOrder, 'size');
    assert.equal(store.get().providerId, 'pcloud');
    assert.deepEqual(JSON.parse(readFileSync(profileFilePath, 'utf8')), {
      appearance: 'light',
      shareDiagnostics: false,
      diagnosticsConsentVersion: 0,
    });

    library = join(root, 'new-library');
    store.activateLibrary();
    assert.equal(store.get().sortOrder, defaultSettings.sortOrder, 'legacy library preferences migrate only once');
    assert.equal(store.get().providerId, defaultSettings.providerId);
  });
});
