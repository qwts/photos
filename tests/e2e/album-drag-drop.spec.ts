import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron, type Locator, type Page } from '@playwright/test';

interface Hitbox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function waitForStableHitbox(locator: Locator): Promise<Hitbox> {
  await expect(locator).toBeVisible();
  let previous = '';
  let latest: Hitbox | null = null;
  await expect
    .poll(
      async () => {
        latest = await locator.boundingBox();
        if (latest === null || latest.width < 4 || latest.height < 4) {
          previous = '';
          return false;
        }
        const fingerprint = [latest.x, latest.y, latest.width, latest.height].map((value) => Math.round(value)).join(':');
        const stable = fingerprint === previous;
        previous = fingerprint;
        return stable;
      },
      { intervals: [50, 50, 100], timeout: 5_000 },
    )
    .toBe(true);
  if (latest === null) throw new Error('drag hitbox disappeared after stabilizing');
  return latest;
}

async function dragPhoto(source: Locator, target: Locator): Promise<void> {
  const [, targetBox] = await Promise.all([waitForStableHitbox(source), waitForStableHitbox(target)]);
  await source.dragTo(target, {
    targetPosition: { x: Math.min(16, targetBox.width / 2), y: targetBox.height / 2 },
  });
}

async function createAlbum(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByRole('textbox', { name: 'Album name' }).fill(name);
  await page.getByRole('textbox', { name: 'Album name' }).press('Enter');
  await expect(albumRow(page, name)).toBeVisible();
}

function albumRow(page: Page, name: string): Locator {
  const escapedName = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return page.locator('.ovl-sidebar__albumrow').filter({
    has: page.getByRole('button', { name: new RegExp(`^${escapedName}(?: ·|\\s|$)`, 'u') }),
  });
}

function albumButton(page: Page, name: string): Locator {
  return albumRow(page, name).locator(':scope > .ovl-siderow');
}

function photo(page: Page, fileName: string): Locator {
  return page.getByRole('button', { name: `Open ${fileName}` });
}

async function select(page: Page, fileName: string): Promise<void> {
  const item = photo(page, fileName);
  await item.hover();
  await item.getByRole('button', { name: 'Select' }).click();
}

async function exerciseListAndRail(page: Page): Promise<void> {
  await page.getByRole('button', { name: /All Photos/u }).click();
  await page.getByRole('radio', { name: 'List' }).click();
  await dragPhoto(photo(page, 'IMG_4056.RAF'), albumButton(page, 'Drop inbox'));
  await expect(page.getByRole('status')).toContainText('Added 1 photo to Drop inbox');
  await expect(albumButton(page, 'Drop inbox')).toContainText('4');

  await page.evaluate(`window.overlook.library.delete({ photoIds: ['01J8SEEDPHOTO0006'] })`);
  await page.getByRole('button', { name: /Recently deleted/u }).click();
  await expect(photo(page, 'IMG_4063.JPG')).toHaveAttribute('draggable', 'false');
  await expect(albumButton(page, 'Drop inbox')).toContainText('4');
  await page.getByRole('button', { name: /All Photos/u }).click();

  await expect
    .poll(() => page.evaluate(`window.overlook.library.get({ id: '01J8SEEDPHOTO0004' }).then((r) => r.photo?.syncState)`))
    .toBe('offloaded');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await dragPhoto(photo(page, 'IMG_4049.JPG'), albumButton(page, 'Rail target'));
  await expect(page.getByRole('status')).toContainText('Added 1 photo to Rail target');
  await expect(page.getByRole('button', { name: 'Rail target · 1' })).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(() => page.evaluate(`window.overlook.library.get({ id: '01J8SEEDPHOTO0004' }).then((r) => r.photo?.syncState)`))
    .toBe('offloaded');
}

// #279 exit criteria: direct + selected-set drags work in virtualized grid
// and list modes; albums are targets in the full sidebar and collapsed rail;
// cross-album drops require Add or Move; duplicates are explicit no-ops; and
// membership-only operations never rehydrate an offloaded original.
test('photo drag-and-drop: add, move, duplicate, collapsed, list, and offloaded states', async () => {
  test.setTimeout(90_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-album-drop-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      // More than the viewport can mount, without competing with the suite's
      // existing 2K-row stress case for startup resources.
      OVERLOOK_SEED: '80',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await photo(page, 'IMG_4021.RAF').waitFor();

    for (const name of ['Drop inbox', 'Drop source', 'Drop destination', 'Rail target']) await createAlbum(page, name);

    const seeded = await page.evaluate<{ added: number }>(`window.overlook.library.albums().then(({ albums }) => {
      const source = albums.find((album) => album.name === 'Drop source');
      return window.overlook.albums.addPhotos({
        albumId: source.id,
        photoIds: ['01J8SEEDPHOTO0000', '01J8SEEDPHOTO0001', '01J8SEEDPHOTO0002', '01J8SEEDPHOTO0003']
      });
    })`);
    expect(seeded.added).toBe(4);
    await expect(albumButton(page, 'Drop source')).toContainText('4');

    // An unselected tile drags only itself.
    await dragPhoto(photo(page, 'IMG_4021.RAF'), albumButton(page, 'Drop inbox'));
    await expect(page.getByRole('status')).toContainText('Added 1 photo to Drop inbox');
    await expect(albumButton(page, 'Drop inbox')).toContainText('1');

    // A selected tile carries the complete selected set through the same
    // bounded payload, even with hundreds of rows behind virtualization.
    await select(page, 'IMG_4028.JPG');
    await select(page, 'IMG_4035.JPG');
    await dragPhoto(photo(page, 'IMG_4028.JPG'), albumButton(page, 'Drop inbox'));
    await expect(page.getByRole('status')).toContainText('Added 2 photos to Drop inbox');
    await expect(albumButton(page, 'Drop inbox')).toContainText('3');
    await page.getByRole('button', { name: 'Clear selection' }).click();

    // Source-to-target add preserves the source memberships.
    await albumButton(page, 'Drop source').click();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(4);
    await select(page, 'IMG_4021.RAF');
    await select(page, 'IMG_4028.JPG');
    await dragPhoto(photo(page, 'IMG_4021.RAF'), albumButton(page, 'Drop destination'));
    const choice = page.getByRole('dialog', { name: 'Add or move photos?' });
    await expect(choice).toContainText('Add keeps the photos in both albums');
    await choice.getByRole('button', { name: 'Add to Drop destination' }).click();
    await expect(page.getByRole('status')).toContainText('Added 2 photos to Drop destination');
    await expect(albumButton(page, 'Drop source')).toContainText('4');
    await expect(albumButton(page, 'Drop destination')).toContainText('2');

    // Repeating the Add is a visible duplicate/no-op, never a silent partial.
    await dragPhoto(photo(page, 'IMG_4021.RAF'), albumButton(page, 'Drop destination'));
    await page.getByRole('dialog', { name: 'Add or move photos?' }).getByRole('button', { name: 'Add to Drop destination' }).click();
    await expect(page.getByRole('status')).toContainText('2 photos already in Drop destination · no changes');
    await expect(albumButton(page, 'Drop destination')).toContainText('2');
    await page.getByRole('button', { name: 'Clear selection' }).click();

    // Move inserts in the destination before removing only source membership;
    // the active source view, counts, and selection update together.
    await select(page, 'IMG_4035.JPG');
    await select(page, 'IMG_4042.JPG');
    await dragPhoto(photo(page, 'IMG_4035.JPG'), albumButton(page, 'Drop destination'));
    await page.getByRole('dialog', { name: 'Add or move photos?' }).getByRole('button', { name: 'Move to Drop destination' }).click();
    await expect(page.getByRole('status')).toContainText('Moved 2 photos to Drop destination');
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(2);
    await expect(albumButton(page, 'Drop source')).toContainText('2');
    await expect(albumButton(page, 'Drop destination')).toContainText('4');
    await expect(page.getByTestId('selection-pill')).toHaveCount(0);

    // The current album is itself a no-op target, with no dialog or mutation.
    await dragPhoto(photo(page, 'IMG_4021.RAF'), albumButton(page, 'Drop source'));
    await expect(page.getByRole('status')).toContainText('1 photo already in Drop source · no changes');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // List rows use the same workflow. Index 4 is seeded offloaded; dropping
    // onto an icon-only rail target changes membership without rehydrating it.
    await exerciseListAndRail(page);
  } finally {
    await app.close();
  }
});
