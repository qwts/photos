import assert from 'node:assert/strict';
import { test } from 'node:test';

import { registerInspectorWindowHandlerContract } from '../../src/main/inspector-window-handlers.js';

test('Inspector window IPC validates requests, admits content, and delegates every operation (#503)', async () => {
  const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();
  const sent: Array<{ name: string; payload: unknown }> = [];
  const opened: unknown[] = [];
  const updated: unknown[] = [];
  let closed = 0;
  let admitted = 0;
  const snapshot = { photoId: 'photo-1', providerLabel: 'Local mock', selectionPosition: { index: 0, count: 2 } };

  registerInspectorWindowHandlerContract({
    admitContent: () => admitted++,
    handle: (name, handler) => handlers.set(name, (_event, request) => handler(request)),
    open: (state) => opened.push(state),
    update: (state) => updated.push(state),
    close: () => closed++,
    snapshot: () => snapshot,
    sendStep: (name, payload) => sent.push({ name, payload }),
  });

  assert.deepEqual(await handlers.get('inspector-window:open')?.({}, snapshot), {});
  assert.deepEqual(await handlers.get('inspector-window:update')?.({}, snapshot), {});
  assert.deepEqual(await handlers.get('inspector-window:close')?.({}, {}), {});
  assert.deepEqual(await handlers.get('inspector-window:step')?.({}, { delta: 1 }), {});
  assert.deepEqual(await handlers.get('inspector-window:snapshot')?.({}, {}), snapshot);
  assert.deepEqual(opened, [snapshot]);
  assert.deepEqual(updated, [snapshot]);
  assert.equal(closed, 1);
  assert.equal(admitted, 5);
  assert.deepEqual(sent, [{ name: 'inspector-window:step-requested', payload: { delta: 1 } }]);
});
