import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  appReducer,
  initialAppState,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  type AppAction,
  type AppState,
} from '../../src/shared/library/app-state.js';

function apply(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(appReducer, state);
}

describe('app state reducer', () => {
  test('zoom clamps to the design range', () => {
    assert.equal(initialAppState.zoom, ZOOM_DEFAULT);
    assert.equal(apply(initialAppState, { type: 'zoom/set', zoom: 10 }).zoom, ZOOM_MIN);
    assert.equal(apply(initialAppState, { type: 'zoom/set', zoom: 9999 }).zoom, ZOOM_MAX);
    assert.equal(apply(initialAppState, { type: 'zoom/set', zoom: 200 }).zoom, 200);
  });

  test('selection toggles, selects all, clears', () => {
    let state = apply(initialAppState, { type: 'selection/toggled', photoId: 'a' }, { type: 'selection/toggled', photoId: 'b' });
    assert.deepEqual([...state.selection].sort(), ['a', 'b']);
    state = apply(state, { type: 'selection/toggled', photoId: 'a' });
    assert.deepEqual([...state.selection], ['b']);
    state = apply(state, { type: 'selection/all', photoIds: ['x', 'y', 'z'] });
    assert.equal(state.selection.size, 3);
    state = apply(state, { type: 'selection/cleared' });
    assert.equal(state.selection.size, 0);
  });

  test('selection survives filter changes only for still-visible items (#78)', () => {
    const b = { id: 'b' } as AppState['photos'][number];
    const c = { id: 'c' } as AppState['photos'][number];
    const selected = apply(initialAppState, { type: 'selection/all', photoIds: ['a', 'b'] });
    // Switching source/chips keeps the selection until the new page lands…
    const switched = apply(selected, { type: 'source/set', source: 'favorites' }, { type: 'chip/toggled', chip: 'raw' });
    assert.equal(switched.selection.size, 2);
    assert.equal(switched.chips.raw, true);
    assert.equal(apply(switched, { type: 'chip/toggled', chip: 'raw' }).chips.raw, false);
    // …then intersects with the freshly visible set: b stays, a drops.
    const landed = apply(switched, { type: 'photos/loaded', photos: [b, c], append: false });
    assert.deepEqual([...landed.selection], ['b']);
    // Appending pages never trims the selection.
    const appended = apply(landed, { type: 'photos/loaded', photos: [{ id: 'd' } as AppState['photos'][number]], append: true });
    assert.deepEqual([...appended.selection], ['b']);
  });

  test('escape exits the lightbox when open, otherwise clears selection', () => {
    const withBoth = apply(initialAppState, { type: 'selection/all', photoIds: ['a'] }, { type: 'lightbox/opened', photoId: 'a' });
    const afterFirst = apply(withBoth, { type: 'escape' });
    assert.equal(afterFirst.lightboxId, null);
    assert.equal(afterFirst.selection.size, 1, 'selection survives the lightbox exit');
    const afterSecond = apply(afterFirst, { type: 'escape' });
    assert.equal(afterSecond.selection.size, 0);
  });

  test('dialog flags set independently', () => {
    const state = apply(
      initialAppState,
      { type: 'dialog/set', dialog: 'import', open: true },
      { type: 'dialog/set', dialog: 'settings', open: true },
      { type: 'dialog/set', dialog: 'import', open: false },
    );
    assert.deepEqual(
      { importOpen: state.importOpen, exportOpen: state.exportOpen, settingsOpen: state.settingsOpen },
      { importOpen: false, exportOpen: false, settingsOpen: true },
    );
  });

  test('photo pages replace or append', () => {
    const a = { id: 'a' } as AppState['photos'][number];
    const b = { id: 'b' } as AppState['photos'][number];
    const loaded = apply(initialAppState, { type: 'photos/loaded', photos: [a], append: false });
    assert.equal(loaded.photos.length, 1);
    const appended = apply(loaded, { type: 'photos/loaded', photos: [b], append: true });
    assert.deepEqual(
      appended.photos.map((photo) => photo.id),
      ['a', 'b'],
    );
    const replaced = apply(appended, { type: 'photos/loaded', photos: [b], append: false });
    assert.deepEqual(
      replaced.photos.map((photo) => photo.id),
      ['b'],
    );
  });

  test('1,500 backup status patches preserve the loaded gallery, selection, and lightbox (#295)', () => {
    const photos = Array.from(
      { length: 1_500 },
      (_, index) => ({ id: `photo-${String(index)}`, syncState: 'local' }) as AppState['photos'][number],
    );
    const loaded = apply(
      initialAppState,
      { type: 'photos/loaded', photos, append: false },
      { type: 'selection/all', photoIds: ['photo-1200', 'photo-1499'] },
      { type: 'lightbox/opened', photoId: 'photo-1200' },
    );

    const patched = apply(loaded, {
      type: 'photos/sync-state-patched',
      updates: photos.map((photo) => ({ id: photo.id, syncState: 'synced' })),
    });

    assert.equal(patched.photos.length, 1_500);
    assert.ok(patched.photos.every((photo) => photo.syncState === 'synced'));
    assert.deepEqual([...patched.selection], ['photo-1200', 'photo-1499']);
    assert.equal(patched.lightboxId, 'photo-1200');
  });

  test('pendingCount and backup label track IPC pushes', () => {
    const state = apply(initialAppState, { type: 'pendingCount/set', count: 42 }, { type: 'backupLabel/set', label: 'JUST NOW' });
    assert.equal(state.pendingCount, 42);
    assert.equal(state.lastBackupLabel, 'JUST NOW');
  });

  test('providerConnected mirrors the settings push (#239)', () => {
    assert.equal(initialAppState.providerConnected, true);
    const off = apply(initialAppState, { type: 'providerConnected/set', connected: false });
    assert.equal(off.providerConnected, false);
    const on = apply(off, { type: 'providerConnected/set', connected: true });
    assert.equal(on.providerConnected, true);
    const selected = apply(on, { type: 'provider/set', connected: false, label: 'Future Cloud' });
    assert.equal(selected.providerConnected, false);
    assert.equal(selected.providerLabel, 'Future Cloud');
  });

  test('query, view, explicit lightbox close, and toast lifecycle', () => {
    let state = apply(
      initialAppState,
      { type: 'query/set', query: 'kyoto' },
      { type: 'view/set', view: 'list' },
      { type: 'lightbox/opened', photoId: 'a' },
      { type: 'lightbox/closed' },
      { type: 'toast/shown', toast: { title: 'EXPORTED', tone: 'green' } },
    );
    assert.equal(state.query, 'kyoto');
    assert.equal(state.view, 'list');
    assert.equal(state.lightboxId, null);
    assert.equal(state.toast?.title, 'EXPORTED');
    state = apply(state, { type: 'toast/dismissed' });
    assert.equal(state.toast, null);
  });

  test('lightbox follows visibility: an id that leaves the photo set closes for real (#92)', () => {
    const photo = (id: string) => ({ id }) as AppState['photos'][number];
    let state = apply(
      initialAppState,
      { type: 'photos/loaded', photos: [photo('a'), photo('b')], append: false },
      { type: 'lightbox/opened', photoId: 'a' },
    );
    // A refetch still containing the photo keeps the lightbox open...
    state = apply(state, { type: 'photos/loaded', photos: [photo('a')], append: false });
    assert.equal(state.lightboxId, 'a');
    // ...but one without it clears the id — no spurious reopen later.
    state = apply(state, { type: 'photos/loaded', photos: [photo('b')], append: false });
    assert.equal(state.lightboxId, null);
  });

  test('lightbox/stepped walks the visible sequence with wraparound (#93)', () => {
    const photo = (id: string) => ({ id }) as AppState['photos'][number];
    // A closed lightbox ignores steps.
    const closed = apply(initialAppState, { type: 'photos/loaded', photos: [photo('a'), photo('b')], append: false });
    assert.equal(apply(closed, { type: 'lightbox/stepped', delta: 1 }).lightboxId, null);

    let state = apply(closed, { type: 'lightbox/opened', photoId: 'a' });
    state = apply(state, { type: 'lightbox/stepped', delta: 1 });
    assert.equal(state.lightboxId, 'b');
    // Forward off the end wraps to the start; backward from the start wraps
    // to the end.
    state = apply(state, { type: 'lightbox/stepped', delta: 1 });
    assert.equal(state.lightboxId, 'a');
    state = apply(state, { type: 'lightbox/stepped', delta: -1 });
    assert.equal(state.lightboxId, 'b');
  });

  test('import-completion toast carries its serializable Show action (#89)', () => {
    const state = apply(initialAppState, {
      type: 'toast/shown',
      toast: { title: 'Imported 1,204 photos', tone: 'green', action: 'show-recent' },
    });
    assert.equal(state.toast?.action, 'show-recent');
    // The Show jump is a plain source/set — reducer semantics unchanged.
    const jumped = apply(state, { type: 'source/set', source: 'recent' }, { type: 'toast/dismissed' });
    assert.equal(jumped.source, 'recent');
    assert.equal(jumped.toast, null);
  });

  test('offload Undo toast preserves the exact photo ids (#281)', () => {
    const state = apply(initialAppState, {
      type: 'toast/shown',
      toast: { title: 'Offloaded 2', tone: 'green', action: 'undo-offload', actionPhotoIds: ['a', 'b'] },
    });
    assert.equal(state.toast?.action, 'undo-offload');
    assert.deepEqual(state.toast?.actionPhotoIds, ['a', 'b']);
  });
});
