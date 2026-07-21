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
