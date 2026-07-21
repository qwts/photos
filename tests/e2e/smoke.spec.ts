import { test, expect, _electron as electron } from '@playwright/test';

import type { OverlookApi } from '../../src/shared/ipc/api.js';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// Launches the real Electron app from the out/ bundle produced by
// global-setup — the lane fails if the app cannot launch, render, or expose
// its bridge, unlike the retired http-server fixture which stayed green
// regardless of app health.
//
// Inside evaluate callbacks the page global is reached via globalThis: the
// tests project compiles without the DOM lib, so there is no `window` type —
// the bridge is typed through the shared contract instead.
test('opens a window rendering the React shell', async () => {
  // The composed shell (#73) fetches library counts on mount, so even the
  // smoke needs an isolated temp profile + the CI-safe keystore.
  const userData = mkE2eTmpDir('overlook-e2e-smoke-');
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, OVERLOOK_USER_DATA: userData, OVERLOOK_INSECURE_KEYSTORE: '1' },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('restore-onboarding')).toBeVisible();
    await expect(page.getByText('Restore from cloud backup')).toBeVisible();
    await page.getByRole('button', { name: 'Start a new library' }).click();
    // An empty library renders the mock's empty state (#76).
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('empty-state').getByText('Nothing matches')).toBeVisible();
    await expect(page).toHaveTitle('Overlook');

    // Composed chrome (#73): sidebar sources, statusbar, toolbar region all
    // present on boot — their internals arrive with #74–#81.
    await expect(page.getByRole('navigation', { name: 'Library' })).toBeVisible();
    await expect(page.getByRole('button', { name: /All Photos/ })).toBeVisible();
    await expect(page.getByTestId('statusbar-left')).toHaveText('0 photos · 0 byte');
    // #81: an empty library is fully backed up by definition.
    await expect(page.getByTestId('sync-state')).toContainText('All backed up');

    // The scaffold's security posture is part of the smoke: the typed bridge
    // is present and no raw Electron surface leaks into the renderer.
    const surface = await page.evaluate(() => {
      // type-coverage:ignore-next-line
      const g = globalThis as unknown as { overlook?: OverlookApi };
      return {
        bridge: typeof g.overlook,
        rawLeak: 'ipcRenderer' in globalThis || 'electron' in globalThis || 'require' in globalThis,
      };
    });
    expect(surface.bridge).toBe('object');
    expect(surface.rawLeak).toBe(false);

    // Typed IPC round-trips against the real main process (#49).
    // type-coverage:ignore-next-line
    const echoed = await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.ping({ message: 'e2e' }));
    expect(echoed).toEqual({ echoed: 'e2e' });
  } finally {
    await app.close();
  }
});
