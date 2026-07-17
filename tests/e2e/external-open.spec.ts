import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, _electron as electron } from '@playwright/test';

const FIXTURE = join(import.meta.dirname, '../fixtures/exif/exif-stripped.jpg');

function makeFolder(count: number, nested = false): { readonly folder: string; readonly paths: readonly string[] } {
  const folder = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-drop-')), 'photos');
  const target = nested ? join(folder, 'nested') : folder;
  mkdirSync(target, { recursive: true });
  const paths = Array.from({ length: count }, (_, index) => {
    const path = join(target, `photo-${String(index).padStart(4, '0')}.jpg`);
    copyFileSync(FIXTURE, path);
    return path;
  });
  return { folder, paths };
}

test('P0 #406: 800 Finder paths route into one running window and one import batch', async () => {
  const { paths } = makeFolder(800);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-large-drop-'));
  const env = { ...process.env, OVERLOOK_USER_DATA: userData, OVERLOOK_INSECURE_KEYSTORE: '1' };
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start a new library' }).click();
    await app.evaluate(({ app }, openedPaths) => {
      app.emit('second-instance', {}, ['/Electron', '/app', ...openedPaths], process.cwd(), {});
    }, paths);

    await expect(page.getByRole('dialog', { name: 'Import photos' })).toBeVisible();
    await expect(page.getByText('800 photos ready to import')).toBeVisible({ timeout: 15_000 });
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('P0 #406: a folder path recursively opens as one dropped import source', async () => {
  const { folder } = makeFolder(3, true);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-folder-drop-'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, OVERLOOK_USER_DATA: userData, OVERLOOK_INSECURE_KEYSTORE: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start a new library' }).click();
    await app.evaluate(({ app }, openedFolder) => {
      app.emit('open-file', { preventDefault: () => undefined }, openedFolder);
    }, folder);

    await expect(page.getByRole('dialog', { name: 'Import photos' })).toBeVisible();
    await expect(page.getByText('3 photos ready to import')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import 3 photos' })).toBeEnabled();
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
  }
});
