import { createHash } from 'node:crypto';
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
  if (extraEnv['OVERLOOK_SEED'] === '0') {
    await page.getByRole('button', { name: 'Start a new library' }).click();
  }
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

    // On disk: 3 files, PROVEN byte-faithful — each exported file's sha256
    // and size must equal the library row's content hash (the plaintext
    // digest) and byte count (PR #199 review).
    const rows = await page.evaluate<{ fileName: string; contentHash: string; bytes: number }[]>(
      `window.overlook.library.page({ source: 'all', limit: 10 }).then((r) => r.photos.map((p) => ({ fileName: p.fileName, contentHash: p.contentHash, bytes: p.bytes })))`,
    );
    const files = readdirSync(destination).sort();
    expect(files).toEqual(['IMG_4028.JPG', 'IMG_4035.JPG', 'IMG_4042.JPG']);
    for (const name of files) {
      const bytes = readFileSync(join(destination, name));
      const row = rows.find((candidate) => candidate.fileName === name);
      expect(row, `library row for ${name}`).toBeDefined();
      expect(bytes.length).toBe(row?.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(row?.contentHash);
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
    expect(bytes.length).toBeGreaterThan(100); // a real re-encode (the fixture preview is 1×1), not a stub or empty file
  } finally {
    await app.close();
  }
});

test('metadata-lite JPEG imports with decoded dimensions, renders, and exports byte-identically (#367)', async () => {
  const destination = mkdtempSync(join(tmpdir(), 'overlook-export-dest-'));
  const card = join(mkdtempSync(join(tmpdir(), 'overlook-zero-dim-card-')), 'SDCARD');
  mkdirSync(card);
  const source = join(import.meta.dirname, '../fixtures/exif/exif-stripped.jpg');
  copyFileSync(source, join(card, 'exif-stripped.jpg'));
  const { app, page } = await launch(destination, { OVERLOOK_SEED: '0', OVERLOOK_IMPORT_SOURCE: card });
  try {
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: 'Import 1 photos' }).click();
    await expect(page.getByText('All 1 photos imported and encrypted.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show in library' }).click();

    const row = await page.evaluate<{ width: number; height: number }>(
      `window.overlook.library.page({ source: 'all', limit: 1 }).then((r) => ({ width: r.photos[0].width, height: r.photos[0].height }))`,
    );
    expect(row).toEqual({ width: 960, height: 1280 });
    await page.getByRole('button', { name: 'Open exif-stripped.jpg' }).click();
    const viewport = page.getByTestId('lightbox-viewport');
    await expect(viewport).toHaveAttribute('data-image-width', '960');
    await expect(viewport).toHaveAttribute('data-image-height', '1280');
    const bounds = await viewport.getByRole('img', { name: 'exif-stripped.jpg' }).boundingBox();
    expect(bounds?.width ?? 0).toBeGreaterThan(0);
    expect(bounds?.height ?? 0).toBeGreaterThan(0);
    await page.keyboard.press('i');
    await expect(page.getByTestId('inspector')).toContainText('960×1280 · 1.2 MP');

    await page.getByTestId('lightbox').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('radio', { name: 'Original' }).click();
    await page.getByRole('button', { name: /Choose folder/u }).click();
    await page.getByRole('button', { name: 'Export 1 photo', exact: true }).click();
    await expect(page.getByText('1 photo exported and decrypted.')).toBeVisible({ timeout: 20_000 });
    expect(readFileSync(join(destination, 'exif-stripped.jpg'))).toEqual(readFileSync(source));
  } finally {
    await app.close();
  }
});
