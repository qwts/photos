import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #111 exit criteria: settings change events observed across the REAL IPC
// boundary — a renderer-side set() round-trips through main's store and the
// settings:changed push lands back in the renderer with the new snapshot.
// (Restart persistence is #116's dedicated spec.)
test('settings round-trip: set() persists in main and the changed event reaches the renderer', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-settings-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '2',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    // Fresh profile: the design defaults.
    const defaults = await page.evaluate<{ settings: { sortOrder: string; bandwidthLimit: number } }>(`window.overlook.settings.get()`);
    expect(defaults.settings.sortOrder).toBe('date');
    expect(defaults.settings.bandwidthLimit).toBe(100);

    // Subscribe, patch, and require the push to arrive with the snapshot.
    const pushed = await page.evaluate<{ sortOrder: string; wifiOnly: boolean }>(
      `new Promise((resolve) => {
        window.overlook.settings.onChanged(({ settings }) => resolve({ sortOrder: settings.sortOrder, wifiOnly: settings.wifiOnly }));
        void window.overlook.settings.set({ patch: { sortOrder: 'name', wifiOnly: false } });
      })`,
    );
    expect(pushed).toEqual({ sortOrder: 'name', wifiOnly: false });

    // And get() agrees — main's store is the single truth.
    const after = await page.evaluate<{ settings: { sortOrder: string } }>(`window.overlook.settings.get()`);
    expect(after.settings.sortOrder).toBe('name');
  } finally {
    await app.close();
  }
});
