import { test, expect, _electron as electron } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// #111 exit criteria: settings change events observed across the REAL IPC
// boundary — a renderer-side set() round-trips through main's store and the
// settings:changed push lands back in the renderer with the new snapshot.
// (Restart persistence is #116's dedicated spec.)
test('settings round-trip: set() persists in main and the changed event reaches the renderer', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-settings-');
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

    const providerCatalog = await page.evaluate<{
      defaultProviderId: string;
      providers: { id: string; label: string; available: boolean; capabilities: { quota: string; verification: string } }[];
    }>(`window.overlook.backup.providers()`);
    expect(providerCatalog.defaultProviderId).toBe('mock');
    expect(providerCatalog.providers.map(({ id }) => id)).toEqual(['pcloud', 'google-drive', 'mock']);
    expect(providerCatalog.providers.find(({ id }) => id === 'google-drive')).toMatchObject({
      label: 'Google Drive',
      available: false,
      capabilities: { quota: 'known', verification: 'server-checksum' },
    });
    expect(providerCatalog.providers.find(({ id }) => id === 'mock')?.capabilities).toMatchObject({
      quota: 'known',
      verification: 'server-checksum',
    });

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
    await expect(page.locator('.ovl-tile__open').first()).toHaveAccessibleName('Open IMG_4021.RAF');
    await page.getByRole('radio', { name: 'Size' }).click();
    await expect(page.locator('.ovl-tile__open').first()).toHaveAccessibleName('Open IMG_4028.JPG');
    // The locked controls render per the pattern: Light disabled, thumbs on.
    await expect(page.getByRole('radio', { name: 'Light' })).toBeDisabled();
    await expect(page.getByRole('switch')).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // The order persists in the store (restart persistence is unit-proven;
    // the full app-restart e2e is #116).
    const persisted = await page.evaluate<{ settings: { sortOrder: string } }>(`window.overlook.settings.get()`);
    expect(persisted.settings.sortOrder).toBe('size');

    // #114 (updated by #239): Storage & Backup opens by default with the
    // connected mock card; Disconnect flips the badge, HIDES the backup
    // knobs (import Copy/Move stays usable — it needs no provider), and
    // persists providerId null; the mock reconnects instantly.
    await page.getByRole('button', { name: 'Settings' }).click();
    const card = page.getByTestId('provider-card');
    await expect(card).toContainText('Connected');
    await page.getByRole('button', { name: 'Disconnect provider' }).click();
    const disconnectConfirmation = page.getByRole('dialog', { name: 'Disconnect Local mock?' });
    await expect(disconnectConfirmation).toContainText('Encrypted data already stored in Local mock is not deleted.');
    await disconnectConfirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toContainText('Connected');
    await expect(disconnectConfirmation).not.toBeVisible();
    await page.getByRole('button', { name: 'Disconnect provider' }).click();
    await page.getByRole('dialog', { name: 'Disconnect Local mock?' }).getByRole('button', { name: 'Disconnect provider' }).click();
    await expect(card).toContainText('Not connected');
    await expect(page.getByRole('radio', { name: 'Google Drive' })).toBeDisabled();
    await expect(page.getByText('Google Drive: Google Drive OAuth is not configured in this build.')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Back up new imports automatically' })).toBeHidden();
    await expect(page.getByRole('switch', { name: 'Wi-Fi only' })).toBeHidden();
    await expect(page.getByRole('slider', { name: 'Upload bandwidth limit' })).toBeHidden();
    await expect(page.getByRole('radio', { name: 'Copy' })).toBeEnabled();
    const provider = await page.evaluate<{ settings: { providerId: string | null } }>(`window.overlook.settings.get()`);
    expect(provider.settings.providerId).toBe(null);
    // A manual run stays blocked outright while disconnected (PR #213).
    const blocked = await page.evaluate<{ skipped: string | null }>(`window.overlook.backup.run({})`);
    expect(blocked.skipped).toBe('disconnected');

    // #239: disconnect hides every provider surface in the shell — no
    // misleading backed-up states anywhere.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Back up' })).toBeHidden();
    await expect(page.getByTestId('sync-state')).toContainText('Local mock NOT CONNECTED');
    await expect(page.getByTestId('backup-card')).toContainText('not connected');
    // The sidebar's Connect link is the path back — it opens Settings.
    await page.getByTestId('sidebar-connect').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await expect(page.getByText('Checking connection…')).toBeHidden();
    const connectButton = page.getByRole('button', { name: 'Connect Local mock' });
    await connectButton.click();
    await expect(card).toContainText('Connected');
    await expect(page.getByRole('switch', { name: 'Back up new imports automatically' })).toBeVisible();
    // Reconnect restores the shell surfaces live, no restart.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Back up' })).toBeVisible();
    await expect(page.getByTestId('sync-state')).not.toContainText('NOT CONNECTED');
    await expect(page.getByTestId('sidebar-connect')).toBeHidden();
    // The #115 Privacy block below expects the dialog open again.
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();

    // #115: the Privacy pane — always-on badge, deferred face grouping
    // (disabled + off, never faked), diagnostics persists through the store.
    await page.getByRole('button', { name: 'Privacy' }).click();
    const pane = page.getByTestId('settings-pane');
    await expect(pane).toContainText('Always on');
    const paneSwitches = pane.getByRole('switch');
    const switchCount = await paneSwitches.count();
    const faceGrouping = paneSwitches.nth(switchCount - 2);
    const diagnostics = paneSwitches.nth(switchCount - 1);
    await expect(faceGrouping).toBeDisabled();
    await expect(faceGrouping).toHaveAttribute('aria-checked', 'false');
    await diagnostics.click();
    await expect
      .poll(async () => page.evaluate<boolean>(`window.overlook.settings.get().then((r) => r.settings.shareDiagnostics)`))
      .toBe(true);
    await expect(pane.getByText('0 pending local reports')).toBeVisible();
    await pane.getByRole('button', { name: 'Review reports…' }).click();
    const diagnosticsDialog = page.getByRole('dialog', { name: 'Review diagnostics' });
    await expect(diagnosticsDialog).toContainText('No reports are waiting locally.');
    await expect(diagnosticsDialog).toContainText('Nothing is sent.');
    await diagnosticsDialog.getByRole('button', { name: 'Done' }).click();
  } finally {
    await app.close();
  }
});

test('settings keeps stable modal geometry and content-only scrolling in a short reduced-motion viewport', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-settings-layout-');
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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 760, height: 420 });
    await page.getByTestId('virtual-grid').waitFor();

    const opener = page.getByRole('button', { name: 'Settings' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const pane = page.getByTestId('settings-pane');
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('animation-duration', '0.001s');
    await expect.poll(async () => (await dialog.boundingBox())?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(388);

    await page.getByRole('button', { name: 'Privacy' }).click();
    await expect(pane).toHaveCSS('overflow-y', 'auto');
    const navTop = (await nav.boundingBox())?.y;
    await page.evaluate("document.querySelector('[data-testid=settings-pane]').scrollTop = 160");
    await expect.poll(() => page.evaluate<number>("document.querySelector('[data-testid=settings-pane]').scrollTop")).toBeGreaterThan(0);
    await expect.poll(async () => (await nav.boundingBox())?.y).toBe(navTop);

    await page.getByRole('button', { name: 'General' }).click();
    await expect(pane).toHaveAttribute('data-section', 'general');
    await expect.poll(() => page.evaluate<number>("document.querySelector('[data-testid=settings-pane]').scrollTop")).toBe(0);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  } finally {
    await app.close();
  }
});
