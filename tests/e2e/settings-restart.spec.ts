import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

// #116 exit criteria: the settings round-trip proven through a REAL app
// restart — values changed in run one persist to disk, and run two both
// reports them over IPC and RENDERS from them (grid order, disconnected
// card) without any user action.

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '2',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
}

test('settings persist across an app restart and re-render the UI', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-settings-restart-'));

  // Run one: change sort, Wi-Fi, bandwidth, and disconnect the provider.
  // Same try/finally as run two — a run-one failure must not orphan the
  // app holding the temp profile (PR #215 review).
  const first = await launch(userData);
  try {
    const page = await first.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();
    // Date order (default): the newest-by-date seed row leads.
    await expect(page.locator('.ovl-tile__img').first()).toHaveAttribute('alt', 'IMG_4021.RAF');

    await page.evaluate(
      `window.overlook.settings.set({ patch: { sortOrder: 'size', wifiOnly: false, bandwidthLimit: 40, providerId: null } })`,
    );
  } finally {
    await first.close();
  }

  // Run two: the same profile reports AND renders the persisted values.
  const second = await launch(userData);
  try {
    const page = await second.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    const persisted = await page.evaluate<{
      settings: { sortOrder: string; wifiOnly: boolean; bandwidthLimit: number; providerId: string | null };
    }>(`window.overlook.settings.get()`);
    expect(persisted.settings).toMatchObject({ sortOrder: 'size', wifiOnly: false, bandwidthLimit: 40, providerId: null });

    // The grid comes up in the persisted order with no user action: size's
    // id-DESC tiebreak leads with IMG_4028 (seed rows share one byte size).
    await expect(page.locator('.ovl-tile__img').first()).toHaveAttribute('alt', 'IMG_4028.JPG');

    // The dialog re-renders the persisted state too: disconnected card,
    // backup controls disabled, slider at 40.
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('provider-card')).toContainText('Not connected');
    await expect(page.getByRole('radio', { name: 'Copy' })).toBeDisabled();
    await expect(page.getByRole('slider', { name: 'Upload bandwidth limit' })).toBeDisabled();
    await expect(page.getByRole('slider', { name: 'Upload bandwidth limit' })).toHaveValue('40');
    await expect(page.getByTestId('settings-pane')).toContainText('40% of available upload');

    // And a manual backup stays blocked while disconnected — the restart
    // did not silently reconnect anything.
    const blocked = await page.evaluate<{ skipped: string | null }>(`window.overlook.backup.run({})`);
    expect(blocked.skipped).toBe('disconnected');
  } finally {
    await second.close();
  }
});
