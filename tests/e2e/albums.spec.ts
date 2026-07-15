import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #117 exit criteria: create → appears with count 0 → the album filters the
// grid; membership dirties the ledger (pendingCount rises). The full
// album + delete/restore journey is #122's spec.
test('albums: inline create, live counts, album-as-source grid filter', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-albums-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '3',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();

    // Back up first so the ledger-dirtying below is unambiguous.
    await page.getByRole('button', { name: 'Back up' }).click();
    await expect(page.getByTestId('sync-state')).toContainText('ALL BACKED UP', { timeout: 20_000 });

    // Inline create from the sidebar's + affordance.
    await page.getByRole('button', { name: 'New album' }).click();
    await page.getByRole('textbox', { name: 'Album name' }).fill('Kyoto trip');
    await page.getByRole('textbox', { name: 'Album name' }).press('Enter');
    const albumRow = page.getByRole('button', { name: /Kyoto trip/u });
    await expect(albumRow).toContainText('0');

    // Membership over IPC (the selection pill lands with #118): the count
    // goes live and the ledger dirties — amber returns with exact counts.
    const added = await page.evaluate<{ added: number }>(
      `window.overlook.library.albums().then(({ albums }) => {
        const album = albums.find((a) => a.name === 'Kyoto trip');
        return window.overlook.albums.addPhotos({ albumId: album.id, photoIds: ['01J8SEEDPHOTO0001', '01J8SEEDPHOTO0002'] });
      })`,
    );
    expect(added.added).toBe(2);
    await expect(albumRow).toContainText('2');
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 2 → LOCAL MOCK');

    // Album as active source: the grid narrows to the two members.
    await albumRow.click();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(2);
    // Back to All Photos: the album deactivates and the full set returns.
    await page.getByRole('button', { name: /All Photos/u }).click();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(3);

    // #118: select → Add to album via the pill picker → exact-count toast
    // → the album count bumps → the album source shows the addition.
    await expect(page.locator('.ovl-tile__img')).toHaveCount(3);
    await page.locator('.ovl-grid__cell').first().hover();
    await page.locator('.ovl-tile__select').first().click();
    await page.getByRole('button', { name: 'Add to album' }).click();
    await page
      .getByTestId('album-picker')
      .getByRole('menuitem', { name: /Kyoto trip/u })
      .click();
    await expect(page.getByRole('status')).toContainText('Added 1 photo to Kyoto trip');
    await expect(albumRow).toContainText('3');
    await albumRow.click();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(3);
  } finally {
    await app.close();
  }
});
