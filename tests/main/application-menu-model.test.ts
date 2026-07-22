import assert from 'node:assert/strict';
import test from 'node:test';
import type { MenuItemConstructorOptions } from 'electron';

import { buildApplicationMenuTemplate, commandEnabled } from '../../src/main/application-menu-model.js';
import { EMPTY_COMMAND_MENU_CONTEXT, type CommandMenuContext } from '../../src/shared/commands/menu-contract.js';
import type { CommandId } from '../../src/shared/commands/registry.js';

function find(items: readonly MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (Array.isArray(item.submenu)) {
      const nested = find(item.submenu, id);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function ids(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [...(item.id === undefined ? [] : [item.id]), ...(Array.isArray(item.submenu) ? ids(item.submenu) : [])]);
}

function submenuLabels(items: readonly MenuItemConstructorOptions[], menu: string): (string | undefined)[] {
  const owner = items.find((item) => (item.label ?? item.role) === menu);
  return Array.isArray(owner?.submenu) ? owner.submenu.map((item) => (item.type === 'separator' ? '—' : (item.label ?? item.role))) : [];
}

const grid: CommandMenuContext = {
  ...EMPTY_COMMAND_MENU_CONTEXT,
  surface: 'grid',
  hasLibrary: true,
  hasPhotos: true,
  appLockConfigured: true,
};

test('macOS menu is the six-menu design-system hierarchy in order (#689)', () => {
  const template = buildApplicationMenuTemplate('darwin', 'Overlook', grid, () => {});
  assert.deepEqual(
    template.map(({ label, role }) => label ?? role),
    ['Overlook', 'File', 'Edit', 'View', 'Photo', 'help'],
  );
  // No Window menu; the lightbox-exit command is not a menu item on mac.
  assert.equal(
    template.some(({ label }) => label === 'Window'),
    false,
  );
  assert.equal(find(template, 'view.lightbox.close'), undefined);
});

test('macOS menu items are the exact per-menu spec order (#689)', () => {
  const template = buildApplicationMenuTemplate('darwin', 'Overlook', grid, () => {});
  // About/Quit are OS roles — their visible labels ("About Overlook" /
  // "Quit Overlook") are supplied by macOS at runtime, so the template only
  // carries the role name.
  assert.deepEqual(submenuLabels(template, 'Overlook'), [
    'about',
    '—',
    'Settings…',
    'Storage & Backup',
    'Transfer & Sync',
    'Privacy & Diagnostics',
    '—',
    'Lock Now',
    '—',
    'quit',
  ]);
  assert.deepEqual(submenuLabels(template, 'File'), ['Import Photos…', 'Export…', '—', 'Switch Library…', 'Move Library…', 'New Library…']);
  assert.deepEqual(submenuLabels(template, 'View'), [
    'All Photos',
    'Favorites',
    'Recent Imports',
    'Trash',
    '—',
    'Grid',
    'List',
    'Feed',
    'Moodboard',
    '—',
    'Show or hide Inspector',
    'Open Inspector in Separate Window',
    'Toggle Sidebar',
  ]);
});

test('macOS accelerators are generated from registry bindings (#689)', () => {
  const template = buildApplicationMenuTemplate('darwin', 'Overlook', grid, () => {});
  assert.equal(find(template, 'app.settings.open')?.accelerator, 'CommandOrControl+,');
  assert.equal(find(template, 'library.import')?.accelerator, 'CommandOrControl+I');
  assert.equal(find(template, 'photo.export')?.accelerator, 'CommandOrControl+Shift+E');
  assert.equal(find(template, 'library.move')?.accelerator, 'CommandOrControl+Shift+M');
  assert.equal(find(template, 'view.inspector.detach')?.accelerator, 'CommandOrControl+Shift+I');
  assert.equal(find(template, 'selection.selectAll')?.accelerator, 'CommandOrControl+A');
  // Menu-item ids stay unique even though Export projects into File + Photo.
  assert.equal(new Set(ids(template)).size, ids(template).length);
});

test('dispatch fires the registry command id (#689)', () => {
  const invoked: CommandId[] = [];
  const template = buildApplicationMenuTemplate('darwin', 'Overlook', grid, (id) => invoked.push(id));
  const privacy = find(template, 'app.settings.open.privacy');
  if (privacy?.click !== undefined) Reflect.apply(privacy.click, privacy, [{}, {}, {}]);
  const exportPhoto = find(template, 'photo.export.photo');
  if (exportPhoto?.click !== undefined) Reflect.apply(exportPhoto.click, exportPhoto, [{}, {}, {}]);
  assert.deepEqual(invoked, ['app.settings.open.privacy', 'photo.export']);
});

test('Lock Now is always shown on mac and disabled without an app password (#689)', () => {
  const unconfigured = buildApplicationMenuTemplate('darwin', 'Overlook', { ...grid, appLockConfigured: false }, () => {});
  assert.equal(find(unconfigured, 'app.lock.now')?.enabled, false);
  const configured = buildApplicationMenuTemplate('darwin', 'Overlook', grid, () => {});
  assert.equal(find(configured, 'app.lock.now')?.enabled, true);
});

test('Photo menu is target-aware: Restore in Trash, membership otherwise (#689)', () => {
  const inTrash = buildApplicationMenuTemplate('darwin', 'Overlook', { ...grid, source: 'deleted' }, () => {});
  assert.deepEqual(submenuLabels(inTrash, 'Photo'), ['Restore photo']);

  const inAlbum = buildApplicationMenuTemplate('darwin', 'Overlook', { ...grid, inAlbum: true }, () => {});
  assert.deepEqual(submenuLabels(inAlbum, 'Photo'), [
    'Toggle favorite',
    'Add to album',
    'Remove from album',
    'Export…',
    '—',
    'Move photo to Trash',
  ]);

  const plain = buildApplicationMenuTemplate('darwin', 'Overlook', grid, () => {});
  assert.equal(find(plain, 'album.membership.remove'), undefined);
});

test('menu enablement fails closed for lock, modal, target, and active-work state (#689)', () => {
  assert.equal(commandEnabled('app.settings.open.privacy', { ...grid, surface: 'locked' }), true);
  assert.equal(commandEnabled('library.import', { ...grid, surface: 'locked' }), false);
  assert.equal(commandEnabled('library.import', { ...grid, providerBusy: true }), false);
  assert.equal(commandEnabled('photo.trash', { ...grid, surface: 'lightbox', hasTarget: true, targetTrashable: true }), true);
  assert.equal(commandEnabled('photo.trash', { ...grid, surface: 'lightbox', hasTarget: true, targetTrashable: false }), false);
  assert.equal(commandEnabled('photo.trash', { ...grid, surface: 'lightbox', targetTrashable: true, dialog: 'settings' }), false);
});

test('Activity is a Help-menu command, not a sidebar/library surface (#690)', () => {
  const invoked: CommandId[] = [];
  const template = buildApplicationMenuTemplate('darwin', 'Overlook', grid, (id) => invoked.push(id));
  // Sits in the Help menu, directly after Keyboard Shortcuts (DS order).
  assert.deepEqual(
    ids(template).filter((id) => id === 'help.shortcuts' || id === 'help.activity' || id === 'help.open'),
    ['help.shortcuts', 'help.activity', 'help.open'],
  );
  const activity = find(template, 'help.activity');
  assert.ok(activity !== undefined);
  // Menu-only: the design system gives Activity no accelerator.
  assert.equal(activity.accelerator, undefined);
  assert.equal(activity.enabled, true);
  if (activity.click !== undefined) Reflect.apply(activity.click, activity, [{}, {}, {}]);
  assert.deepEqual(invoked, ['help.activity']);

  // Per-library and lock-gated: disabled without a library or while locked.
  assert.equal(commandEnabled('help.activity', grid), true);
  assert.equal(commandEnabled('help.activity', { ...grid, hasLibrary: false }), false);
  assert.equal(commandEnabled('help.activity', { ...grid, surface: 'locked' }), false);
});

test('commands pending handler wiring are disabled until the follow-up PR (#689)', () => {
  // These project into the menu structure now but stay disabled until their
  // cross-surface handlers + target-aware enablement land in the next slice.
  for (const id of [
    'library.move',
    'library.new',
    'view.sidebar.toggle',
    'view.mode.feed',
    'photo.export',
    'photo.restore',
    'album.membership.add',
    'album.membership.remove',
    'selection.clear',
  ] as const) {
    assert.equal(commandEnabled(id, { ...grid, source: 'deleted', inAlbum: true, hasTarget: true, selectionCount: 3 }), false);
  }
});

test('checked state follows only the focused window context (#689)', () => {
  const template = buildApplicationMenuTemplate(
    'darwin',
    'Overlook',
    { ...grid, source: 'favorites', view: 'list', inspectorOpen: true },
    () => {},
  );
  assert.equal(find(template, 'library.source.favorites')?.checked, true);
  assert.equal(find(template, 'view.mode.list')?.checked, true);
  assert.equal(find(template, 'view.inspector.toggle')?.checked, true);
});

test('the moodboard view radio checks only when the board view is active (#515)', () => {
  const onBoard = buildApplicationMenuTemplate('darwin', 'Overlook', { ...grid, view: 'moodboard' }, () => {});
  assert.equal(find(onBoard, 'view.mode.moodboard')?.checked, true);
  assert.equal(find(onBoard, 'view.mode.grid')?.checked, false);
  const onGrid = buildApplicationMenuTemplate('darwin', 'Overlook', { ...grid, view: 'grid' }, () => {});
  assert.equal(find(onGrid, 'view.mode.moodboard')?.checked, false);
});

test('Windows/Linux menu is unchanged: keeps Window menu and no Overlook app menu (#689)', () => {
  const template = buildApplicationMenuTemplate('win32', 'Overlook', grid, () => {});
  assert.deepEqual(
    template.map(({ label, role }) => label ?? role),
    ['File', 'Edit', 'View', 'Photo', 'Window', 'help'],
  );
  // The non-mac File menu still carries the flattened settings + quit fallback.
  assert.notEqual(find(template, 'app.settings.open'), undefined);
  assert.notEqual(find(template, 'view.lightbox.close'), undefined);
  // #689 scopes the ⌘I Import accelerator to macOS; win/linux Import stays
  // accelerator-free (the shared descriptor's key must not leak there).
  assert.equal(find(template, 'library.import')?.accelerator, undefined);
  const mac = buildApplicationMenuTemplate('darwin', 'Overlook', grid, () => {});
  assert.equal(find(mac, 'library.import')?.accelerator, 'CommandOrControl+I');
});
