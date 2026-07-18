import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, _electron as electron, type Page } from '@playwright/test';

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

async function stageFinderFiles(page: Page, paths: readonly string[]): Promise<void> {
  await page.evaluate(`(() => {
    document.querySelector('[data-testid="finder-drop-files"]')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.dataset.testid = 'finder-drop-files';
    input.hidden = true;
    document.body.append(input);
  })()`);
  await page.getByTestId('finder-drop-files').setInputFiles([...paths]);
}

async function dispatchFinderEvent(page: Page, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', selector: string): Promise<boolean> {
  return page.evaluate<boolean>(`(() => {
    const input = document.querySelector('[data-testid="finder-drop-files"]');
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!input?.files || !target) throw new Error('Finder-drop test target is unavailable');
    const files = input.files;
    const transfer = {
      files,
      items: Array.from(files).map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      types: ['public.file-url'],
      dropEffect: 'none',
    };
    const event = new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
}

test('P0 #486: Finder-shaped drops over a modal stay responsive and cannot open content windows', async () => {
  const { folder } = makeFolder(1);
  const raw = join(folder, 'mixed.NEF');
  const heic = join(folder, 'mixed.HEIC');
  copyFileSync(FIXTURE, raw);
  copyFileSync(FIXTURE, heic);
  const jpeg = join(folder, 'photo-0000.jpg');
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-window-drop-'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, OVERLOOK_USER_DATA: userData, OVERLOOK_INSECURE_KEYSTORE: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start a new library' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await stageFinderFiles(page, [raw, jpeg, heic]);

    expect(await dispatchFinderEvent(page, 'dragenter', '.ovl-dialog')).toBe(true);
    await expect(page.getByText('Drop photos to import')).toBeVisible();
    await page.evaluate(`(() => {
      const target = document.querySelector('.ovl-dialog');
      const input = document.querySelector('[data-testid="finder-drop-files"]');
      if (!target || !input?.files) throw new Error('Finder-drop churn target is unavailable');
      const transfer = {
        files: input.files,
        items: Array.from(input.files).map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
        types: ['public.file-url'],
        dropEffect: 'none',
      };
      for (const type of ['dragleave', 'dragover']) {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        target.dispatchEvent(event);
      }
    })()`);
    await expect(page.getByText('Drop photos to import')).toBeVisible();

    expect(await dispatchFinderEvent(page, 'drop', '.ovl-dialog')).toBe(true);
    const importDialog = page.getByRole('dialog', { name: 'Import photos' });
    await expect(importDialog).toBeVisible();
    await expect(importDialog.getByText('3 photos ready to import')).toBeVisible();
    expect(app.windows()).toHaveLength(1);
    expect(await dispatchFinderEvent(page, 'drop', '.ovl-dialog')).toBe(true);
    await expect(importDialog).toHaveCount(1);
    await expect(importDialog.getByText('3 photos ready to import')).toBeVisible();
    await expect(page.getByText('Drop photos to import')).toBeHidden();
    await importDialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    const trustedUrl = page.url();
    await page.evaluate(`window.open('file:///Users/ansel/Private/should-not-open.NEF')`);
    await expect.poll(() => app.windows().length).toBe(1);
    expect(page.url()).toBe(trustedUrl);
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Settings' }).click();
    await stageFinderFiles(page, [raw]);
    await dispatchFinderEvent(page, 'dragenter', '.ovl-dialog');
    await expect(page.getByText('Drop photos to import')).toBeVisible();
    await page.evaluate(`window.dispatchEvent(new Event('blur'))`);
    await expect(page.getByText('Drop photos to import')).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    const unsupported = join(folder, 'notes.txt');
    copyFileSync(FIXTURE, unsupported);
    await stageFinderFiles(page, [unsupported]);
    expect(await dispatchFinderEvent(page, 'drop', '.ovl-dialog')).toBe(true);
    await expect(page.getByText('Nothing to import — drop photo files')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Import photos' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

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
