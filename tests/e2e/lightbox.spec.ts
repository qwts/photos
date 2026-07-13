import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #93 exit criteria: the mock's keyboard contract in lightbox mode — ←/→
// step the visible sequence with wraparound, Esc closes the lightbox first
// (dual semantics), i toggles the Inspector — all without clicking to focus.
test('lightbox keyboard: arrows with wraparound, i for inspector, Esc precedence', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-lightbox-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '4',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    // Open from the grid (photo 0 is the seed's RAW record → PREVIEW badge).
    // Wait for a REAL PhotoTile (placeholder cells render first on a slow
    // first page and have no open handler — PR #188 review).
    await page.locator('.ovl-tile__img').first().waitFor();
    await page.locator('.ovl-grid__cell').first().click();
    const lightbox = page.getByTestId('lightbox');
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toContainText('IMG_4021.RAF');
    await expect(lightbox).toContainText('PREVIEW');

    // → steps forward through the VISIBLE sequence — no click-to-focus.
    await page.keyboard.press('ArrowRight');
    await expect(lightbox).toContainText('IMG_4028.JPG');

    // ← twice from photo 1 wraps past 0 to the LAST photo (index 3).
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(lightbox).toContainText('IMG_4042.JPG');
    // → from the last wraps forward to the first again.
    await page.keyboard.press('ArrowRight');
    await expect(lightbox).toContainText('IMG_4021.RAF');

    // i toggles the Inspector while the lightbox stays up — and the panel
    // shows the REAL record (#94): seeded camera, dimensions, key metadata.
    await page.keyboard.press('i');
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('RAW');
    await expect(inspector).toContainText('FUJIFILM X-T5');
    await expect(inspector).toContainText('6240×4160 · 26.0 MP');
    await expect(inspector).toContainText('AES-256-GCM · KEY #1');
    await page.keyboard.press('i');
    await expect(inspector).toBeHidden();

    // Esc closes the lightbox FIRST (dual semantics live in the reducer).
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    await expect(page.getByTestId('virtual-grid')).toBeVisible();
  } finally {
    await app.close();
  }
});
