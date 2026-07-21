import { expect, test } from './support/app.js';

test('album reorder: keyboard, collapsed menu, undo, and persistence (#225)', async ({ launchOverlook }) => {
  const { page } = await launchOverlook({ prefix: 'overlook-e2e-album-reorder-', env: { OVERLOOK_SEED: '2' } });
  const createAlbum = async (name: string): Promise<void> => {
    await page.getByRole('button', { name: 'New album' }).click();
    await page.getByRole('textbox', { name: 'Album name' }).fill(name);
    await page.getByRole('textbox', { name: 'Album name' }).press('Enter');
    await expect(page.locator('.ovl-sidebar__albumrow', { hasText: name })).toBeVisible();
  };
  const names = (): Promise<string[]> => page.locator('.ovl-sidebar__albumrow .ovl-siderow__label').allTextContents();

  await createAlbum('One');
  await createAlbum('Two');
  await createAlbum('Three');
  const handle = page.getByRole('button', { name: 'Reorder Two, position 2 of 3' });
  await handle.focus();
  await handle.press('Space');
  await handle.press('ArrowDown');
  await handle.press('Space');
  await expect.poll(names).toEqual(['One', 'Three', 'Two']);
  await expect(page.getByTestId('screen-reader-announcer-polite')).toContainText('Two moved to position 3 of 3');
  await expect(page.getByRole('button', { name: 'Reorder Two, position 3 of 3' })).toBeFocused();

  await page.keyboard.press('Meta+z');
  await expect.poll(names).toEqual(['One', 'Two', 'Three']);
  await page.reload();
  await expect.poll(names).toEqual(['One', 'Two', 'Three']);

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  const collapsed = page.getByRole('button', { name: 'Three · 0 · album 3 of 3' });
  await expect(page.getByRole('button', { name: /Reorder Three/u })).toHaveCount(0);
  await collapsed.focus();
  await collapsed.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move to top' }).click();
  await expect.poll(names).toEqual(['Three', 'One', 'Two']);
});
