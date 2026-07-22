import assert from 'node:assert/strict';
import test from 'node:test';
import type { MenuItemConstructorOptions } from 'electron';

import { buildApplicationMenuTemplate, commandEnabled } from '../../src/main/application-menu-model.js';
import { EMPTY_COMMAND_MENU_CONTEXT, type CommandMenuContext } from '../../src/shared/commands/menu-contract.js';
import type { CommandId } from '../../src/shared/commands/registry.js';

function find(items: readonly MenuItemConstructorOptions[], id: CommandId): MenuItemConstructorOptions | undefined {
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

const grid: CommandMenuContext = {
  ...EMPTY_COMMAND_MENU_CONTEXT,
  surface: 'grid',
  hasLibrary: true,
  hasPhotos: true,
  appLockConfigured: true,
};

test('macOS menu follows the accepted hierarchy and registry accelerators (#531)', () => {
  const invoked: CommandId[] = [];
  const template = buildApplicationMenuTemplate('darwin', 'Overlook', grid, (id) => invoked.push(id));
  assert.deepEqual(
    template.map(({ label, role }) => label ?? role),
    ['Overlook', 'File', 'Edit', 'View', 'Photo', 'Window', 'help'],
  );
  assert.equal(find(template, 'app.settings.open')?.accelerator, 'CommandOrControl+,');
  assert.equal(find(template, 'view.inspector.detach')?.accelerator, 'CommandOrControl+Shift+I');
  assert.equal(new Set(ids(template)).size, ids(template).length);
  const privacy = find(template, 'app.settings.open.privacy');
  if (privacy?.click !== undefined) Reflect.apply(privacy.click, privacy, [{}, {}, {}]);
  assert.deepEqual(invoked, ['app.settings.open.privacy']);
});

test('menu enablement fails closed for lock, modal, target, and active-work state (#531)', () => {
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
  const help = template.find((item) => item.role === 'help');
  assert.ok(help !== undefined && Array.isArray(help.submenu));
  // Sits with the other Help commands, directly after Keyboard Shortcuts (DS order).
  const helpIds = (help.submenu as MenuItemConstructorOptions[]).map((item) => item.id);
  assert.deepEqual(
    helpIds.filter((id) => id === 'help.shortcuts' || id === 'help.activity'),
    ['help.shortcuts', 'help.activity'],
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

test('checked state follows only the focused window context (#531)', () => {
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
