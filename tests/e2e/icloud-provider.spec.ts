import { test, expect, _electron as electron } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// #658: the deterministic native boundary drives the real production runtime,
// IPC, generic backup/offload/rehydration engines, and renderer surfaces. The
// native signed-build acceptance remains in #659.
test('iCloud Drive composes through settings, backup, offload, and restore-originals', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-icloud-');
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '4',
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_ICLOUD_FAKE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();

    expect(await page.evaluate(`window.overlook.backup.connect({ providerId: 'icloud-drive' })`)).toEqual({ ok: true, reason: null });
    const status = await page.evaluate<{
      connected: boolean;
      usedBytes: number | null;
      totalBytes: number | null;
      provider: { id: string; capabilities: { quota: string; verification: string } };
    }>(`window.overlook.backup.providerStatus({ providerId: 'icloud-drive' })`);
    expect(status).toMatchObject({
      connected: true,
      usedBytes: null,
      totalBytes: null,
      provider: { id: 'icloud-drive', capabilities: { quota: 'unknown', verification: 'download-hash' } },
    });

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('provider-card')).toContainText('iCloud Drive');
    await expect(page.getByTestId('provider-card')).toContainText('storage usage not reported');
    await expect(page.getByTestId('provider-card')).toContainText('Verify by download');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Back up' }).click();
    await expect(page.getByTestId('screen-reader-announcer-polite')).toContainText('Backup complete', { timeout: 20_000 });
    const offloaded = await page.evaluate<{ offloaded: number }>(`window.overlook.backup.offload({ photoIds: ['01J8SEEDPHOTO0000'] })`);
    expect(offloaded.offloaded).toBe(1);
    await expect(page.locator('.ovl-grid__cell').first().getByRole('img', { name: 'Offloaded to cloud' })).toBeVisible();

    const restored = await page.evaluate<{ restored: number; failed: number }>(
      `window.overlook.backup.restoreOriginals({ photoIds: ['01J8SEEDPHOTO0000'] })`,
    );
    expect(restored).toMatchObject({ restored: 1, failed: 0 });
    await expect
      .poll(() => page.evaluate(`window.overlook.library.get({ id: '01J8SEEDPHOTO0000' }).then((r) => r.photo?.syncState)`))
      .toBe('synced');
  } finally {
    await app.close();
  }
});
