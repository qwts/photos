import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #120 exit criteria: delete from grid AND lightbox → Recently deleted →
// restore → back with favorite/status intact. Purge lands with #121.
test('soft delete: grid + lightbox routes, trash restore keeps state intact', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-trash-'));
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

    // Favorite photo 1 so restore can prove state survives the round-trip.
    await page.evaluate(`window.overlook.library.toggleFavorite({ id: '01J8SEEDPHOTO0001' })`);

    // Grid route: select tile 1 → pill Delete → toast + counts move.
    await page.locator('.ovl-grid__cell').nth(1).hover();
    await page.locator('.ovl-tile__select').nth(1).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('status')).toContainText('Moved 1 photo to Recently deleted');
    await expect(page.getByRole('button', { name: 'Recently deleted 1' })).toBeVisible();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(2);

    // Lightbox route: open the first remaining photo, Delete — the row
    // leaves the visible set, which closes the lightbox.
    await page.locator('.ovl-grid__cell').first().click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await page.getByTestId('lightbox').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('lightbox')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Recently deleted 2' })).toBeVisible();

    // Trash shows both; the pill flips to Restore (no Delete/Export).
    await page.getByRole('button', { name: 'Recently deleted 2' }).click();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('selection-pill')).toContainText('2 SELECTED');
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    await expect(page.getByTestId('selection-pill').getByRole('button', { name: 'Delete' })).toHaveCount(0);

    // Restore both: favorite came back intact, trash empties.
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('status')).toContainText('Restored 2 photos');
    await page.getByRole('button', { name: /All Photos/u }).click();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(3);
    const favorite = await page.evaluate<boolean>(
      `window.overlook.library.get({ id: '01J8SEEDPHOTO0001' }).then((r) => r.photo?.favorite ?? false)`,
    );
    expect(favorite).toBe(true);
    await expect(page.getByRole('button', { name: 'Recently deleted 0' })).toBeVisible();
  } finally {
    await app.close();
  }
});
