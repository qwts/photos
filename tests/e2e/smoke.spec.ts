import { test, expect, _electron as electron } from '@playwright/test';

import type { OverlookApi } from '../../src/shared/ipc/api.js';

// Launches the real Electron app from the out/ bundle produced by
// global-setup — the lane fails if the app cannot launch, render, or expose
// its bridge, unlike the retired http-server fixture which stayed green
// regardless of app health.
//
// Inside evaluate callbacks the page global is reached via globalThis: the
// tests project compiles without the DOM lib, so there is no `window` type —
// the bridge is typed through the shared contract instead.
test('opens a window rendering the React shell', async () => {
  const app = await electron.launch({ args: ['.'] });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('#root p')).toHaveText('Overlook — shell placeholder');
    await expect(page).toHaveTitle('Overlook');

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
