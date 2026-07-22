import { expect, test } from './support/app.js';

test('album reorder: keyboard, collapsed menu, undo, and persistence (#225)', async ({ launchOverlook }) => {
  test.setTimeout(60_000);
  const { page } = await launchOverlook({ prefix: 'overlook-e2e-album-reorder-', env: { OVERLOOK_SEED: '1' } });
  const createAlbum = async (name: string): Promise<void> => {
    await page.getByRole('button', { name: 'New album' }).click();
    await page.getByRole('textbox', { name: 'Album name' }).fill(name);
    await page.getByRole('textbox', { name: 'Album name' }).press('Enter');
    await expect(page.locator('.ovl-sidebar__albumrow', { hasText: name })).toBeVisible();
  };
  const names = (): Promise<string[]> => page.locator('.ovl-sidebar__albumrow .ovl-siderow__label').allTextContents();

  const existing = await names();
  await createAlbum('One');
  await createAlbum('Two');
  await createAlbum('Three');
  const total = existing.length + 3;
  const handle = page.getByRole('button', { name: `Reorder Two, position ${String(total - 1)} of ${String(total)}` });
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(names).toEqual([...existing, 'One', 'Three', 'Two']);
  await expect(page.getByTestId('screen-reader-announcer-polite')).toContainText(
    `Two moved to position ${String(total)} of ${String(total)}`,
  );
  await expect(page.getByRole('button', { name: `Reorder Two, position ${String(total)} of ${String(total)}` })).toBeFocused();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(names).toEqual([...existing, 'One', 'Two', 'Three']);
  await page.reload();
  await expect.poll(names).toEqual([...existing, 'One', 'Two', 'Three']);

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  const collapsed = page.getByRole('button', { name: `Three · 0 · album ${String(total)} of ${String(total)}` });
  await expect(page.getByRole('button', { name: /Reorder Three/u })).toHaveCount(0);
  await collapsed.focus();
  await collapsed.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move to top' }).click();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect.poll(names).toEqual(['Three', ...existing, 'One', 'Two']);
});
