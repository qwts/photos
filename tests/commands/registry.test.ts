import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMANDS,
  activeShortcuts,
  findShortcutConflicts,
  formatShortcut,
  resolveCommand,
  type CommandContext,
} from '../../src/shared/commands/registry.js';

const gridContext: CommandContext = {
  surface: 'grid',
  dialogOpen: false,
  editable: false,
  platform: 'darwin',
};

test('command registry has stable unique IDs and no active binding conflicts (#399)', () => {
  assert.equal(new Set(COMMANDS.map(({ id }) => id)).size, COMMANDS.length);
  assert.deepEqual(findShortcutConflicts(COMMANDS), []);
});

test('context resolution protects fields and gives the lightbox arrow precedence (#399)', () => {
  assert.equal(resolveCommand({ key: 'a', metaKey: true }, gridContext)?.id, 'selection.selectAll');
  assert.equal(resolveCommand({ key: 'i' }, gridContext)?.id, 'view.inspector.toggle');
  assert.equal(resolveCommand({ key: '?' }, gridContext)?.id, 'help.shortcuts');
  assert.equal(resolveCommand({ key: '/', shiftKey: true }, gridContext)?.id, 'help.shortcuts');

  assert.equal(resolveCommand({ key: 'a', metaKey: true }, { ...gridContext, editable: true }), null);
  assert.equal(resolveCommand({ key: 'i' }, { ...gridContext, editable: true }), null);
  assert.equal(resolveCommand({ key: 'ArrowRight' }, { ...gridContext, surface: 'lightbox' })?.id, 'view.lightbox.next');
  assert.equal(resolveCommand({ key: 'k', metaKey: true }, { ...gridContext, surface: 'lightbox' }), null);
  assert.equal(resolveCommand({ key: 'ArrowRight' }, gridContext)?.id, 'grid.focus.right');
  assert.equal(resolveCommand({ key: 'ArrowRight' }, { ...gridContext, dialogOpen: true }), null);
});

test('shortcut help is generated from the active registry projection (#399)', () => {
  const ids = activeShortcuts(gridContext).map(({ id }) => id);
  assert.ok(ids.includes('selection.selectAll'));
  assert.ok(ids.includes('grid.focus.right'));
  assert.ok(!ids.includes('view.lightbox.next'));
  assert.equal(
    formatShortcut(
      COMMANDS.find(({ id }) => id === 'selection.selectAll')!,
      'darwin',
    ),
    '⌘A',
  );
  assert.equal(
    formatShortcut(
      COMMANDS.find(({ id }) => id === 'selection.selectAll')!,
      'win32',
    ),
    'Ctrl+A',
  );
});
