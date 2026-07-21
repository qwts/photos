import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { createInspectorWindowController } from '../../src/main/inspector-window-controller.js';
import type { InspectorWindowState } from '../../src/shared/inspector-window-contract.js';

class FakeWindow extends EventEmitter {
  destroyed = false;
  loading = true;
  closes = 0;
  shows = 0;
  focuses = 0;
  readonly sent: Array<{ name: string; payload: unknown }> = [];
}

const state = (photoId: string): InspectorWindowState => ({
  photoId,
  providerLabel: 'Local mock',
  selectionPosition: { index: 0, count: 2 },
});

test('Inspector state survives reloads and every loaded document receives the latest state (#503 review)', () => {
  const windows: FakeWindow[] = [];
  const primary = new FakeWindow();
  let shouldShow = true;
  const controller = createInspectorWindowController<FakeWindow>({
    createWindow: () => {
      const win = new FakeWindow();
      windows.push(win);
      return win;
    },
    allWindows: () => [primary, ...windows],
    isDestroyed: (win) => win.destroyed,
    isLoading: (win) => win.loading,
    onClosed: (win, listener) => win.once('closed', listener),
    onDidFinishLoad: (win, listener) => win.on('did-finish-load', listener),
    send: (win, name, payload) => win.sent.push({ name, payload }),
    close: (win) => win.closes++,
    show: (win) => win.shows++,
    focus: (win) => win.focuses++,
    shouldShow: () => shouldShow,
  });

  controller.close();
  controller.update(state('before-open'));
  controller.open(state('photo-1'));
  const first = windows[0];
  assert.ok(first);
  assert.equal(controller.isInspectorWindow(first), true);
  assert.deepEqual([first.shows, first.focuses, first.sent.length], [1, 1, 0]);

  first.loading = false;
  first.emit('did-finish-load');
  assert.deepEqual(first.sent.at(-1), { name: 'inspector-window:changed', payload: state('photo-1') });

  controller.update(state('photo-2'));
  assert.deepEqual(first.sent.at(-1), { name: 'inspector-window:changed', payload: state('photo-2') });
  first.loading = true;
  controller.update(state('photo-3'));
  assert.equal(first.sent.length, 2);
  first.loading = false;
  first.emit('did-finish-load');
  first.emit('did-finish-load');
  assert.deepEqual(first.sent.slice(-2), [
    { name: 'inspector-window:changed', payload: state('photo-3') },
    { name: 'inspector-window:changed', payload: state('photo-3') },
  ]);

  controller.open(state('photo-4'));
  assert.deepEqual([first.shows, first.focuses], [2, 2]);
  assert.deepEqual(controller.snapshot(), state('photo-4'));
  controller.close();
  assert.equal(first.closes, 1);

  first.destroyed = true;
  shouldShow = false;
  controller.update(state('destroyed'));
  controller.open(state('photo-5'));
  const second = windows[1];
  assert.ok(second);
  assert.deepEqual([second.shows, second.focuses], [0, 0]);
  first.emit('closed');
  assert.equal(controller.isInspectorWindow(second), true);

  second.emit('closed');
  assert.equal(controller.isInspectorWindow(second), false);
  assert.deepEqual(primary.sent.at(-1), { name: 'inspector-window:closed', payload: {} });
  assert.equal(
    second.sent.some(({ name }) => name === 'inspector-window:closed'),
    false,
  );
});
