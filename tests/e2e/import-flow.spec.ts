import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #90 exit criteria: the whole import path proven in CI — fixture folder in,
// encrypted library out. The OVERLOOK_IMPORT_SOURCE harness hook is the
// mock-file-dialog seam: it surfaces the fixture card as the first source.

const FIXTURES = join(import.meta.dirname, '../fixtures/exif');
const CARD_FILES = ['exif-full.jpg', 'sample.raf', 'exif-stripped.jpg'];
const RAW_EXTENSIONS = ['raf', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2'] as const;

function makeCard(): string {
  const card = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-card-')), 'SDCARD');
  mkdirSync(card);
  for (const name of CARD_FILES) {
    copyFileSync(join(FIXTURES, name), join(card, name));
  }
  return card;
}

function makeRawMatrixCard(): string {
  const card = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-raw-card-')), 'RAW-CARD');
  mkdirSync(card);
  const jpeg = readFileSync(join(FIXTURES, 'exif-full.jpg'));
  for (const extension of RAW_EXTENSIONS) {
    writeFileSync(join(card, `sample.${extension}`), Buffer.concat([Buffer.from(`OVERLOOK-${extension}-`), jpeg]));
  }
  return card;
}

/** Every file under `dir` containing `marker` as raw bytes. */
function filesContaining(dir: string, marker: Buffer): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const path = join(dir, name);
    try {
      if (statSync(path).isFile() && readFileSync(path).includes(marker)) {
        hits.push(name);
      }
    } catch {
      continue;
    }
  }
  return hits;
}

async function launch(card: string) {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-import-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_IMPORT_SOURCE: card,
    },
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start a new library' }).click();
  return { app, userData };
}

test('Copy import: dialog flow, encrypted at rest, grid + toast + counts', async () => {
  const card = makeCard();
  const { app, userData } = await launch(card);
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    // Options: the fixture card surfaced through the harness seam.
    await expect(page.getByText('SDCARD')).toBeVisible();
    await expect(page.getByText('3 NEW ·')).toBeVisible();
    await page.getByRole('button', { name: 'Import 3 photos' }).click();

    // Done: clean summary, then Show in library.
    await expect(page.getByText('All 3 photos imported and encrypted.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show in library' }).click();

    // Toast fires only after the modal is gone (#89 + PR #185 review).
    const toast = page.getByRole('status');
    await expect(toast).toContainText('Imported 3 photos');
    await expect(toast.getByRole('button', { name: 'Show' })).toBeVisible();

    // The grid shows the batch with real decoded thumbs; sidebar counts live.
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'All Photos 3' })).toBeVisible();

    // Action stays reachable past the ordinary 4s timeout, then activating it
    // dismisses the toast (#411).
    await page.waitForTimeout(4_200);
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Show' }).click();
    await expect(toast).toBeHidden();

    // Beneath the UI: complete DB rows through the typed bridge...
    const rows = await page.evaluate<{ camera: string | null; id: string; syncState: string }[]>(
      `window.overlook.library.page({ source: 'all', limit: 10 }).then((r) => r.photos.map((p) => ({ camera: p.camera, id: p.id, syncState: p.syncState })))`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.camera === 'FUJIFILM X-T5')).toBe(true);
    for (const row of rows) {
      expect(row.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    }

    // Auto-backup-on-import (#105/#111, default on): the batch uploads to
    // the mock provider in the background and every row lands synced.
    await expect
      .poll(
        async () =>
          page.evaluate<string[]>(
            `window.overlook.library.page({ source: 'all', limit: 10 }).then((r) => r.photos.map((p) => p.syncState))`,
          ),
        { timeout: 15_000 },
      )
      .toEqual(['synced', 'synced', 'synced']);

    // ...and no plaintext fixture bytes anywhere in the profile (blobs and
    // DB encrypted; derivatives strip metadata; no-store protocols).
    const needle = readFileSync(join(FIXTURES, 'exif-full.jpg')).subarray(600, 640);
    expect(filesContaining(userData, needle)).toEqual([]);

    // Copy mode: the card is untouched.
    expect(readdirSync(card).sort()).toEqual([...CARD_FILES].sort());
  } finally {
    await app.close();
  }
});

test('Move import: warning shown, sources emptied only after verified import', async () => {
  const card = makeCard();
  const { app } = await launch(card);
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('radio', { name: 'Move' }).click();
    await expect(page.getByRole('alert')).toContainText('Originals will be deleted from the card after import.');
    await page.getByRole('button', { name: 'Import 3 photos' }).click();
    await expect(page.getByText('All 3 photos imported and encrypted.')).toBeVisible({ timeout: 30_000 });

    // Every file verified (decrypt + re-hash) before its source was removed.
    expect(readdirSync(card)).toEqual([]);
    for (const name of CARD_FILES) {
      expect(existsSync(join(card, name))).toBe(false);
    }
  } finally {
    await app.close();
  }
});

test('RAW matrix: every accepted extension imports with a visible tile and lightbox preview (#368)', async () => {
  const { app } = await launch(makeRawMatrixCard());
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('8 NEW ·')).toBeVisible();
    await page.getByRole('button', { name: 'Import 8 photos' }).click();
    await expect(page.getByText('All 8 photos imported and encrypted.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show in library' }).click();

    const images = page.getByTestId('virtual-grid').locator('.ovl-tile__img');
    await expect(images).toHaveCount(8);
    await expect
      .poll(async () =>
        images.evaluateAll((nodes) => nodes.every((node) => (node as unknown as { readonly naturalWidth: number }).naturalWidth > 0)),
      )
      .toBe(true);
    const rows = await page.evaluate<{ fileKind: string; width: number; height: number }[]>(
      `window.overlook.library.page({ source: 'all', limit: 20 }).then((r) => r.photos.map((p) => ({ fileKind: p.fileKind, width: p.width, height: p.height })))`,
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.fileKind === 'raw' && row.width > 0 && row.height > 0)).toBe(true);

    await page
      .getByRole('button', { name: /Open sample\./u })
      .first()
      .click();
    await expect(page.getByText('PREVIEW', { exact: true })).toBeVisible();
    await expect(page.getByText('PREVIEW UNAVAILABLE')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Folder import (#237): picker seam, forced Copy, pipeline rejects Move for folders', async () => {
  const folder = makeCard();
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-import-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      // No OVERLOOK_IMPORT_SOURCE: the folder path is the source under test.
      OVERLOOK_IMPORT_FOLDER: folder,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start a new library' }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    // Source picker (#237): switch to Local folder and pick through the
    // harness-seamed dialog.
    await page.getByRole('radio', { name: 'Local folder' }).click();
    await page.getByText('Choose a folder to import').click();
    await expect(page.getByText(folder)).toBeVisible();
    await expect(page.getByText('3 NEW ·')).toBeVisible();

    // Folder imports never delete a user's own files: Move is locked in the
    // UI with the design's note...
    await expect(page.getByRole('radio', { name: 'Move' })).toBeDisabled();
    await expect(page.getByText('Imported files are copied — source files are left untouched.')).toBeVisible();
    // ...and the pipeline refuses it outright even if the UI is bypassed.
    const rejected = await page.evaluate<string>(
      `window.overlook.import.run({ path: ${JSON.stringify(folder)}, mode: 'move' }).then(() => 'resolved', (e) => String(e))`,
    );
    expect(rejected).toContain('IPC_HANDLER_FAILED');
    expect(rejected).not.toContain('Move is only available for removable volumes');

    await page.getByRole('button', { name: 'Import 3 photos' }).click();
    await expect(page.getByText('All 3 photos imported and encrypted.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show in library' }).click();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);

    // Copy semantics held: the source folder is untouched.
    expect(readdirSync(folder).sort()).toEqual([...CARD_FILES].sort());
  } finally {
    await app.close();
  }
});

test('Google Drive import (#465): selected cloud files use the copy-only encrypted pipeline', async () => {
  const driveFiles = makeCard();
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-drive-import-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_GOOGLE_DRIVE_IMPORT_SOURCE: driveFiles,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start a new library' }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('radio', { name: 'Google Drive' }).click();
    await page.getByText('Choose photos from Google Drive').click();

    await expect(page.getByText('3 photos selected from Google Drive')).toBeVisible();
    await expect(page.getByText('3 NEW ·')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Move' })).toBeDisabled();
    await page.getByRole('button', { name: 'Import 3 photos' }).click();
    await expect(page.getByText('All 3 photos imported and encrypted.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show in library' }).click();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);

    const sources = await page.evaluate<string[]>(
      `window.overlook.library.page({ source: 'all', limit: 10 }).then((r) => r.photos.map((p) => p.importSource))`,
    );
    expect(sources).toEqual(['Google Drive', 'Google Drive', 'Google Drive']);
    expect(readdirSync(driveFiles).sort()).toEqual([...CARD_FILES].sort());
  } finally {
    await app.close();
  }
});
