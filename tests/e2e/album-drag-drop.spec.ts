import type { Locator, Page } from '@playwright/test';

import { test, expect } from './support/app.js';

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

/**
 * Drag a photo onto an album row, synchronized on the app's OWN drop
 * feedback instead of screen geometry (#363, #630). The HTML5 drag events
 * are dispatched directly at the source and target *locators* over one
 * shared DataTransfer, so Playwright re-resolves each element at dispatch
 * time: a sidebar relayout after switching Grid→List can no longer route the
 * drop to whatever album happens to sit at a stale coordinate. Before the
 * drop we require the target row to report the drag as `allowed` (or `no-op`
 * for a same-album drop) — the app's own readiness signal that this row, not
 * a neighbour, is the drop target.
 */
async function dragPhoto(page: Page, source: Locator, targetName: string, expectedPhase: 'allowed' | 'no-op' = 'allowed'): Promise<void> {
  const targetRow = albumRow(page, targetName);
  await waitForStableHitbox(source);
  await waitForStableHitbox(targetRow);
  // The tests project compiles without the DOM lib, so DataTransfer is
  // untyped here; reach it through globalThis and hand back a typed handle.
  const dataTransfer = await page.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => object }).DataTransfer());
  try {
    await source.dispatchEvent('dragstart', { dataTransfer });
    await targetRow.dispatchEvent('dragenter', { dataTransfer });
    await targetRow.dispatchEvent('dragover', { dataTransfer });
    await expect(targetRow).toHaveClass(new RegExp(`ovl-sidebar__albumrow--drop-${expectedPhase}\\b`, 'u'));
    await targetRow.dispatchEvent('drop', { dataTransfer });
  } finally {
    await source.dispatchEvent('dragend', { dataTransfer }).catch(() => undefined);
    await dataTransfer.dispose();
  }
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
  return albumRow(page, name).locator('.ovl-siderow');
}

function photo(page: Page, fileName: string): Locator {
  return page.getByRole('button', { name: `Open ${fileName}` });
}

function photoGroup(page: Page, fileName: string): Locator {
  return page.getByRole('group').filter({ has: photo(page, fileName) });
}

async function select(page: Page, fileName: string): Promise<void> {
  const item = photoGroup(page, fileName);
  await item.hover();
  await item.getByRole('button', { name: 'Select' }).click();
}

async function exerciseListAndRail(page: Page): Promise<void> {
  await page.getByRole('button', { name: /All Photos/u }).click();
  await page.getByRole('radio', { name: 'List' }).click();
  await dragPhoto(page, photo(page, 'IMG_4056.RAF'), 'Drop inbox');
  await expect(albumButton(page, 'Drop inbox')).toContainText('4');

  await page.evaluate(`window.overlook.library.delete({ photoIds: ['01J8SEEDPHOTO0006'] })`);
  await page.getByRole('button', { name: /Trash/u }).click();
  await expect(photo(page, 'IMG_4063.JPG')).toHaveAttribute('draggable', 'false');
  await expect(albumButton(page, 'Drop inbox')).toContainText('4');
  await page.getByRole('button', { name: /All Photos/u }).click();

  await expect
    .poll(() => page.evaluate(`window.overlook.library.get({ id: '01J8SEEDPHOTO0004' }).then((r) => r.photo?.syncState)`))
    .toBe('offloaded');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await dragPhoto(page, photo(page, 'IMG_4049.JPG'), 'Rail target');
  await expect(page.getByRole('button', { name: 'Rail target · 1' })).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(() => page.evaluate(`window.overlook.library.get({ id: '01J8SEEDPHOTO0004' }).then((r) => r.photo?.syncState)`))
    .toBe('offloaded');
}

// #279 exit criteria: direct + selected-set drags work in virtualized grid
// and list modes; albums are targets in the full sidebar and collapsed rail;
// cross-album drops require Add or Move; duplicates are explicit no-ops; and
// membership-only operations never rehydrate an offloaded original.
test('photo drag-and-drop: add, move, duplicate, collapsed, list, and offloaded states', async ({ launchOverlook }) => {
  test.setTimeout(90_000);
  // Seed 80: more than the viewport can mount, without competing with the
  // suite's existing 2K-row stress case for startup resources.
  const { page } = await launchOverlook({ prefix: 'overlook-e2e-album-drop-', env: { OVERLOOK_SEED: '80' } });
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
  await dragPhoto(page, photo(page, 'IMG_4021.RAF'), 'Drop inbox');
  await expect(albumButton(page, 'Drop inbox')).toContainText('1');

  // A selected tile carries the complete selected set through the same
  // bounded payload, even with hundreds of rows behind virtualization.
  await select(page, 'IMG_4028.JPG');
  await select(page, 'IMG_4035.JPG');
  await dragPhoto(page, photo(page, 'IMG_4028.JPG'), 'Drop inbox');
  await expect(albumButton(page, 'Drop inbox')).toContainText('3');
  await page.getByRole('button', { name: 'Clear selection' }).click();

  // Source-to-target add preserves the source memberships.
  await albumButton(page, 'Drop source').click();
  await expect(page.locator('.ovl-grid__cell')).toHaveCount(4);
  await select(page, 'IMG_4021.RAF');
  await select(page, 'IMG_4028.JPG');
  await dragPhoto(page, photo(page, 'IMG_4021.RAF'), 'Drop destination');
  const choice = page.getByRole('dialog', { name: 'Add or move photos?' });
  await expect(choice).toContainText('Add keeps the photos in both albums');
  await choice.getByRole('button', { name: 'Add to Drop destination' }).click();
  await expect(albumButton(page, 'Drop source')).toContainText('4');
  await expect(albumButton(page, 'Drop destination')).toContainText('2');

  // Repeating the Add is a complete no-op, never a silent partial mutation.
  await dragPhoto(page, photo(page, 'IMG_4021.RAF'), 'Drop destination');
  await page.getByRole('dialog', { name: 'Add or move photos?' }).getByRole('button', { name: 'Add to Drop destination' }).click();
  await expect(albumButton(page, 'Drop destination')).toContainText('2');
  await page.getByRole('button', { name: 'Clear selection' }).click();

  // Move inserts in the destination before removing only source membership;
  // the active source view, counts, and selection update together.
  await select(page, 'IMG_4035.JPG');
  await select(page, 'IMG_4042.JPG');
  await dragPhoto(page, photo(page, 'IMG_4035.JPG'), 'Drop destination');
  await page.getByRole('dialog', { name: 'Add or move photos?' }).getByRole('button', { name: 'Move to Drop destination' }).click();
  await expect(page.locator('.ovl-grid__cell')).toHaveCount(2);
  await expect(albumButton(page, 'Drop source')).toContainText('2');
  await expect(albumButton(page, 'Drop destination')).toContainText('4');
  await expect(page.getByTestId('selection-pill')).toHaveCount(0);

  // The current album is itself a no-op target, with no dialog or mutation.
  await dragPhoto(page, photo(page, 'IMG_4021.RAF'), 'Drop source', 'no-op');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(albumButton(page, 'Drop source')).toContainText('2');

  // List rows use the same workflow. Index 4 is seeded offloaded; dropping
  // onto an icon-only rail target changes membership without rehydrating it.
  await exerciseListAndRail(page);
});
