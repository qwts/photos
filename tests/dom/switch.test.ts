import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Switch } from '../../src/renderer/src/components/Switch.js';

let root: Root | undefined;

afterEach(() => {
  if (root !== undefined) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
});

test('Switch mounts in a real DOM and reports pointer activation', () => {
  const changes: boolean[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(createElement(Switch, { checked: true, label: 'Wi-Fi only', onChange: (checked) => changes.push(checked) }));
  });

  const control = document.querySelector('[role="switch"]');
  assert.ok(control instanceof HTMLButtonElement);
  assert.equal(control.getAttribute('aria-checked'), 'true');
  assert.equal(control.textContent, 'Wi-Fi only');

  act(() => control.click());
  assert.deepEqual(changes, [false]);

  act(() => {
    root?.render(createElement(Switch, { checked: false, label: 'Wi-Fi only' }));
  });
  assert.equal(control.getAttribute('aria-checked'), 'false');
});
