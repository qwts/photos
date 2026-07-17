import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';
import type { OverlookApi } from '../../src/shared/ipc/api.js';

const FIXTURES = join(import.meta.dirname, '../fixtures/exif');
const JFIF_COUNT = 48;
const PHOTO_COUNT = JFIF_COUNT + 1;
const JFIF_APP0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

interface BackupProbe {
  readonly progress: number;
  readonly completed: boolean;
}

function commentSegment(comment: string): Buffer {
  const payload = Buffer.from(comment, 'ascii');
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, 0xfe, length >> 8, length & 0xff]), payload]);
}

function makeJfifCard(): string {
  const card = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-jfif-card-')), 'JFIF-CARD');
  mkdirSync(card);
  const baseline = readFileSync(join(FIXTURES, 'exif-stripped.jpg'));
  expect([...baseline.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  expect(baseline.includes(Buffer.from('Exif\0\0', 'ascii'))).toBe(false);

  for (let index = 1; index <= JFIF_COUNT; index += 1) {
    const name = `jfif-${String(index).padStart(2, '0')}.jpg`;
    const bytes = Buffer.concat([
      baseline.subarray(0, 2),
      JFIF_APP0,
      commentSegment(`OVERLOOK-JFIF-${String(index).padStart(2, '0')}`),
      baseline.subarray(2),
    ]);
    expect(bytes.subarray(6, 10).toString('ascii')).toBe('JFIF');
    expect(bytes.includes(Buffer.from('Exif\0\0', 'ascii'))).toBe(false);
    writeFileSync(join(card, name), bytes);
  }
  copyFileSync(join(FIXTURES, 'exif-full.jpg'), join(card, 'exif-neighbor.jpg'));
  return card;
}

test('JFIF imports stay in full view through repeated navigation and backup updates (#419)', async () => {
  test.setTimeout(90_000);
  const card = makeJfifCard();
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-jfif-lightbox-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_IMPORT_SOURCE: card,
    },
  });

  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start a new library' }).click();
    await page.evaluate(() =>
      (globalThis as unknown as { overlook: OverlookApi }).overlook.settings.set({ patch: { autoBackupOnImport: false } }),
    );
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(`${String(PHOTO_COUNT)} NEW ·`)).toBeVisible();
    await page.getByRole('button', { name: `Import ${String(PHOTO_COUNT)} photos` }).click();
    await expect(page.getByText(`All ${String(PHOTO_COUNT)} photos imported and encrypted.`)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Show in library' }).click();

    const rows = await page.evaluate<{ fileName: string; width: number; height: number }[]>(() =>
      (globalThis as unknown as { overlook: OverlookApi }).overlook.library
        .page({ source: 'all', limit: 100 })
        .then(({ photos }) => photos.map(({ fileName, width, height }) => ({ fileName, width, height }))),
    );
    expect(rows).toHaveLength(PHOTO_COUNT);
    const jfifRows = rows.filter(({ fileName }) => fileName.startsWith('jfif-'));
    expect(jfifRows).toHaveLength(JFIF_COUNT);
    expect(jfifRows.every(({ width, height }) => width === 960 && height === 1280)).toBe(true);

    const selectedName = 'jfif-01.jpg';
    const openedName = 'jfif-02.jpg';
    const selectedCell = page.getByRole('button', { name: `Open ${selectedName}`, exact: true });
    await selectedCell.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('button', { name: `Open ${openedName}`, exact: true }).click();

    const lightbox = page.getByTestId('lightbox');
    const image = lightbox.locator('.ovl-lightbox__img');
    await expect(lightbox).toBeVisible();
    await expect(image).toHaveAttribute('alt', openedName);
    await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');
    await expect(page.getByRole('button', { name: `All Photos ${String(PHOTO_COUNT)}` })).toHaveClass(/ovl-siderow--active/u);

    await page.evaluate(() => {
      const scope = globalThis as unknown as { overlook: OverlookApi; __jfifBackupProbe: BackupProbe };
      scope.__jfifBackupProbe = { progress: 0, completed: false };
      scope.overlook.backup.onProgress(() => {
        scope.__jfifBackupProbe = { ...scope.__jfifBackupProbe, progress: scope.__jfifBackupProbe.progress + 1 };
      });
      scope.overlook.backup.onCompleted(() => {
        scope.__jfifBackupProbe = { ...scope.__jfifBackupProbe, completed: true };
      });
    });
    const backup = page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.backup.run({}));
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as { __jfifBackupProbe: BackupProbe }).__jfifBackupProbe.progress))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => (globalThis as unknown as { __jfifBackupProbe: BackupProbe }).__jfifBackupProbe.completed)).toBe(
      false,
    );

    const names = rows.map(({ fileName }) => fileName);
    let currentIndex = names.indexOf(openedName);
    expect(currentIndex).toBeGreaterThanOrEqual(0);
    const moves = Array.from({ length: 20 }, (_, index) => (index < 12 ? 1 : -1));
    for (const [step, delta] of moves.entries()) {
      if (step % 2 === 0) {
        await page.keyboard.press(delta === 1 ? 'ArrowRight' : 'ArrowLeft');
      } else {
        await lightbox.getByRole('button', { name: delta === 1 ? 'Next (→)' : 'Previous (←)' }).click();
      }
      currentIndex = (currentIndex + delta + names.length) % names.length;
      const expectedName = names[currentIndex];
      expect(expectedName).toBeDefined();
      await expect(lightbox).toBeVisible();
      await expect(image).toHaveAttribute('alt', expectedName ?? '');
      await expect
        .poll(() => image.evaluate((node) => (node as unknown as { readonly naturalWidth: number }).naturalWidth))
        .toBeGreaterThan(0);
      await expect
        .poll(() => image.evaluate((node) => (node as unknown as { readonly naturalHeight: number }).naturalHeight))
        .toBeGreaterThan(0);
      await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');
    }

    expect(await backup).toMatchObject({ uploaded: PHOTO_COUNT, failed: 0, skipped: null });
    await expect(lightbox).toBeVisible();
    await expect(page.getByRole('button', { name: `All Photos ${String(PHOTO_COUNT)}` })).toHaveClass(/ovl-siderow--active/u);
  } finally {
    await app.close();
  }
});
