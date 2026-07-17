import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SettingsStore } from '../../src/main/settings/settings-store.js';
import { channels } from '../../src/shared/ipc/channels.js';
import { wrapHandler } from '../../src/shared/ipc/registry.js';
import { defaultSettings, throttlePercentOf } from '../../src/shared/settings/settings.js';

// #111: one typed settings truth — defaults per the design, atomic JSON
// persistence, per-key corrupt recovery, change events. The IPC boundary
// (settings:set) is exercised through the real channel schema, so the
// locked key and range rules are proven where they actually enforce.

function storeIn(dir: string): SettingsStore {
  return new SettingsStore({ filePath: join(dir, 'settings.json') });
}

describe('settings store (#111)', () => {
  test('a fresh profile gets the design defaults', () => {
    const store = storeIn(mkdtempSync(join(tmpdir(), 'overlook-settings-')));
    assert.deepEqual(store.get(), defaultSettings);
    assert.equal(store.get().sortOrder, 'date');
    assert.equal(store.get().autoBackupOnImport, true);
    assert.equal(store.get().reOffloadAfterViewing, true);
    assert.equal(store.get().wifiOnly, true);
  });

  test('EXIT CRITERIA: settings persist across a restart (new store, same file)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-settings-'));
    storeIn(dir).set({
      sortOrder: 'name',
      bandwidthLimit: 40,
      providerId: null,
      reOffloadAfterViewing: false,
      shareDiagnostics: true,
    });

    const reborn = storeIn(dir);
    assert.equal(reborn.get().sortOrder, 'name');
    assert.equal(reborn.get().bandwidthLimit, 40);
    assert.equal(reborn.get().providerId, null, 'disconnected survives — null is a value, not "unset"');
    assert.equal(reborn.get().reOffloadAfterViewing, false);
    assert.equal(reborn.get().shareDiagnostics, true);
    assert.equal(reborn.get().diagnosticsConsentVersion, 1);
    assert.equal(reborn.get().wifiOnly, true, 'untouched keys keep their defaults');
  });

  test('EXIT CRITERIA: an unparseable file recovers to defaults, then heals on the next write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-settings-'));
    writeFileSync(join(dir, 'settings.json'), '{ not json', 'utf8');

    const store = storeIn(dir);
    assert.deepEqual(store.get(), defaultSettings);
    store.set({ sortOrder: 'size' });
    assert.equal(storeIn(dir).get().sortOrder, 'size', 'the write replaced the corrupt file');
  });

  test('one bad key falls back alone — the rest of the file survives', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-settings-'));
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        sortOrder: 'name',
        bandwidthLimit: 'fast',
        wifiOnly: false,
        thumbnailsOnImport: false,
        reOffloadAfterViewing: 'sometimes',
      }),
      'utf8',
    );

    const settings = storeIn(dir).get();
    assert.equal(settings.sortOrder, 'name', 'good key kept');
    assert.equal(settings.wifiOnly, false, 'good key kept');
    assert.equal(settings.bandwidthLimit, defaultSettings.bandwidthLimit, 'bad key → its default');
    assert.equal(settings.thumbnailsOnImport, true, 'locked key cannot be persisted off');
    assert.equal(settings.reOffloadAfterViewing, true, 'invalid custody policy recovers to its safe default');
  });

  test('writes are atomic: live file always parses, no staging file left behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-settings-'));
    const store = storeIn(dir);
    store.set({ appearance: 'dark' });
    const onDisk: unknown = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    assert.deepEqual(onDisk, store.get());
    assert.equal(existsSync(join(dir, 'settings.json.tmp')), false);
  });

  test('change events push the full snapshot; unsubscribe stops them', () => {
    const store = storeIn(mkdtempSync(join(tmpdir(), 'overlook-settings-')));
    const seen: string[] = [];
    const unsubscribe = store.subscribe((settings) => seen.push(settings.sortOrder));
    store.set({ sortOrder: 'name' });
    store.set({ sortOrder: 'size' });
    unsubscribe();
    store.set({ sortOrder: 'date' });
    assert.deepEqual(seen, ['name', 'size']);
  });

  test('IPC boundary: the locked key and slider range reject in the channel schema', async () => {
    const store = storeIn(mkdtempSync(join(tmpdir(), 'overlook-settings-')));
    const handler = wrapHandler(channels.settingsSet, ({ patch }) => ({ settings: store.set(patch) }));

    const invalid = { __overlookIpcFailure: true, error: { code: 'IPC_INVALID_REQUEST' } } as const;
    assert.deepEqual(await handler({ patch: { thumbnailsOnImport: false } }), invalid, 'locked true by design');
    assert.deepEqual(await handler({ patch: { bandwidthLimit: 5 } }), invalid, 'below the slider floor');
    assert.deepEqual(await handler({ patch: { bandwidthLimit: 101 } }), invalid, 'above unlimited');
    assert.deepEqual(await handler({ patch: { sortOrder: 'random' } }), invalid, 'unknown enum value');
    assert.deepEqual(await handler({ patch: { providerId: '../cloud' } }), invalid, 'unsafe provider registry key');
    assert.deepEqual(await handler({ patch: { diagnosticsConsentVersion: 1 } }), invalid, 'renderer cannot forge consent policy');

    const ok = await handler({ patch: { bandwidthLimit: 10, wifiOnly: false, providerId: 'future-cloud' } });
    assert.ok('settings' in ok);
    assert.equal(ok.settings.bandwidthLimit, 10);
    assert.equal(store.get().wifiOnly, false);
    assert.equal(store.get().providerId, 'future-cloud', 'new adapters need no settings enum edit');
  });

  test('legacy local-only preference never upgrades silently into current diagnostics consent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-settings-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ ...defaultSettings, shareDiagnostics: true }), 'utf8');

    const store = storeIn(dir);
    assert.equal(store.get().shareDiagnostics, false);
    assert.equal(store.get().diagnosticsConsentVersion, 0);
    store.set({ shareDiagnostics: true });
    assert.equal(store.get().shareDiagnostics, true);
    assert.equal(store.get().diagnosticsConsentVersion, 1);
    store.set({ shareDiagnostics: false });
    assert.equal(store.get().diagnosticsConsentVersion, 0);
  });

  test('throttle mapping: 100 = unlimited (null), anything lower passes through', () => {
    assert.equal(throttlePercentOf({ ...defaultSettings, bandwidthLimit: 100 }), null);
    assert.equal(throttlePercentOf({ ...defaultSettings, bandwidthLimit: 40 }), 40);
  });
});
