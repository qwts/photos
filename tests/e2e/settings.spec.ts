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

    // #112: the sidebar gear opens the dialog, Storage & Backup is the
    // default-open section, and Esc closes it.
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByTestId('settings-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Storage & Backup' })).toHaveAttribute('aria-current', 'true');

    // #113: sort change re-orders the grid LIVE. Seed rows share one byte
    // size, so 'size' falls to its id-DESC tiebreak — the first tile flips
    // from the newest-by-date (IMG_4021.RAF) to the highest id (IMG_4028).
    await page.getByRole('button', { name: 'General' }).click();
    await expect(page.locator('.ovl-tile__img').first()).toHaveAttribute('alt', 'IMG_4021.RAF');
    await page.getByRole('radio', { name: 'Size' }).click();
    await expect(page.locator('.ovl-tile__img').first()).toHaveAttribute('alt', 'IMG_4028.JPG');
    // The locked controls render per the pattern: Light disabled, thumbs on.
    await expect(page.getByRole('radio', { name: 'Light' })).toBeDisabled();
    await expect(page.getByRole('switch')).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // The order persists in the store (restart persistence is unit-proven;
    // the full app-restart e2e is #116).
    const persisted = await page.evaluate<{ settings: { sortOrder: string } }>(`window.overlook.settings.get()`);
    expect(persisted.settings.sortOrder).toBe('size');

    // #114: Storage & Backup opens by default with the connected mock card;
    // Disconnect flips the badge, disables every backup control, and
    // persists providerId null; the mock reconnects instantly.
    await page.getByRole('button', { name: 'Settings' }).click();
    const card = page.getByTestId('provider-card');
    await expect(card).toContainText('Connected');
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(card).toContainText('Not connected');
    await expect(page.getByRole('radio', { name: 'Copy' })).toBeDisabled();
    await expect(page.getByRole('switch').first()).toBeDisabled();
    const provider = await page.evaluate<{ settings: { providerId: string | null } }>(`window.overlook.settings.get()`);
    expect(provider.settings.providerId).toBe(null);
    // The slider is REALLY disabled (keyboard-inert), and a manual run is
    // blocked outright while disconnected (PR #213 review).
    await expect(page.getByRole('slider', { name: 'Upload bandwidth limit' })).toBeDisabled();
    const blocked = await page.evaluate<{ skipped: string | null }>(`window.overlook.backup.run({})`);
    expect(blocked.skipped).toBe('disconnected');
    await page.getByRole('button', { name: 'Connect Mock provider' }).click();
    await expect(card).toContainText('Connected');
    await expect(page.getByRole('radio', { name: 'Copy' })).toBeEnabled();
  } finally {
    await app.close();
  }
});
