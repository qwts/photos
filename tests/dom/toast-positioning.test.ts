import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

test('shell toast inline-end positioning wins when generic host CSS loads later (#536, #405)', () => {
  const tokens = document.createElement('style');
  tokens.textContent = `:root {
    --space-4: 16px;
    --space-6: 24px;
    --space-8: 32px;
    --statusbar-h: 28px;
    --control-h-sm: 32px;
  }`;
  const shell = document.createElement('style');
  shell.textContent = readFileSync('src/renderer/src/shell/shell.css', 'utf8');
  const overlays = document.createElement('style');
  overlays.textContent = readFileSync('src/renderer/src/components/overlays.css', 'utf8');
  document.head.append(tokens, shell, overlays);

  const host = document.createElement('div');
  host.className = 'ovl-toast-host ovl-shell__toast';
  document.body.append(host);

  const style = getComputedStyle(host);
  assert.equal(style.insetInlineEnd, '16px');
  assert.equal(style.bottom, 'calc(28px + 32px + 32px)');
  assert.equal(style.zIndex, '10');
});
