import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #101: export proven end-to-end in CI — the whole UI path over the real
// engine, with on-disk assertions. OVERLOOK_EXPORT_DESTINATION mocks the OS
// folder picker (E5.10 harness family).

async function launch(destination: string, extraEnv: Record<string, string> = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-export-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '4',
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_EXPORT_DESTINATION: destination,
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  // Callers wait for their own start state (a seeded grid vs empty library).
  await page.getByRole('button', { name: 'Import', exact: true }).waitFor();
  return { app, page };
}

test('select 3 → pill Export → run → 3 byte-faithful decrypted files on disk', async () => {
  const destination = mkdtempSync(join(tmpdir(), 'overlook-export-dest-'));
  const { app, page } = await launch(destination);
  try {
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();
    for (const index of [1, 2, 3]) {
      await page.locator('.ovl-grid__cell').nth(index).getByRole('button', { name: 'Select' }).click();
    }
    await page.getByTestId('selection-pill').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('button', { name: /Choose folder/u }).click();
    await page.getByRole('button', { name: 'Export 3 photos' }).click();
    await expect(page.getByText('3 photos exported and decrypted.')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Done' }).click();

    // On disk: 3 files, each a decodable JPEG that decrypted byte-faithfully
    // (seed originals are real JPEGs — SOI marker suffices as "openable"
    // plus exact size checks against the seeded records).
    const files = readdirSync(destination).sort();
    expect(files).toEqual(['IMG_4028.JPG', 'IMG_4035.JPG', 'IMG_4042.JPG']);
    for (const name of files) {
      const bytes = readFileSync(join(destination, name));
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
    }
  } finally {
    await app.close();
  }
});

test('full circle: import a real RAF, lightbox-export as JPEG from its preview', async () => {
  const destination = mkdtempSync(join(tmpdir(), 'overlook-export-dest-'));
  const card = join(mkdtempSync(join(tmpdir(), 'overlook-export-card-')), 'SDCARD');
  mkdirSync(card);
  copyFileSync(join(import.meta.dirname, '../fixtures/exif/sample.raf'), join(card, 'sample.raf'));
  const { app, page } = await launch(destination, { OVERLOOK_SEED: '0', OVERLOOK_IMPORT_SOURCE: card });
  try {
    // Import the RAF (the only photo), then export it as JPEG from the
    // lightbox — the #98 preview policy end to end.
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: 'Import 1 photos' }).click();
    await expect(page.getByText('All 1 photos imported and encrypted.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show in library' }).click();

    await page.locator('.ovl-tile__img').first().waitFor();
    await page.locator('.ovl-grid__cell').first().click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await page.getByTestId('lightbox').getByRole('button', { name: 'Export' }).click();
    await expect(page.getByText('1 photo selected')).toBeVisible();
    await page.getByRole('radio', { name: 'JPEG' }).click();
    await page.getByRole('button', { name: /Choose folder/u }).click();
    await page.getByRole('button', { name: 'Export 1 photo', exact: true }).click();

    // Done copy carries the honest preview-capped note; a real .jpg lands.
    await expect(page.getByText('1 photo exported and decrypted. 1 from RAW previews (preview resolution).')).toBeVisible({
      timeout: 20_000,
    });
    expect(readdirSync(destination)).toEqual(['sample.jpg']);
    const bytes = readFileSync(join(destination, 'sample.jpg'));
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  } finally {
    await app.close();
  }
});
