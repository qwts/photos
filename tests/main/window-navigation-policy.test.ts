import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WebContents } from 'electron';

import { installWindowNavigationPolicy, type BlockedWindowNavigation } from '../../src/main/window-navigation-policy.js';

type NavigationListener = (event: { preventDefault: () => void }, url: string) => void;
type WindowOpenHandler = (details: { url: string }) => { action: 'deny' };

test('content windows deny navigation and popup creation without reporting private paths', () => {
  let navigation: NavigationListener | undefined;
  let windowOpen: WindowOpenHandler | undefined;
  const diagnostics: BlockedWindowNavigation[] = [];
  const webContents = {
    on: (_event: string, listener: NavigationListener) => {
      navigation = listener;
      return webContents;
    },
    setWindowOpenHandler: (handler: WindowOpenHandler) => {
      windowOpen = handler;
    },
  } as unknown as Pick<WebContents, 'on' | 'setWindowOpenHandler'>;

  installWindowNavigationPolicy(webContents, (diagnostic) => diagnostics.push(diagnostic));

  let prevented = false;
  navigation?.({ preventDefault: () => (prevented = true) }, 'file:///Users/ansel/Private/secret.NEF');
  assert.equal(prevented, true);
  assert.deepEqual(windowOpen?.({ url: 'https://example.test/new-window' }), { action: 'deny' });
  assert.deepEqual(diagnostics, [
    { source: 'navigation', scheme: 'file:' },
    { source: 'window-open', scheme: 'https:' },
  ]);
  assert.equal(JSON.stringify(diagnostics).includes('secret.NEF'), false);
});
