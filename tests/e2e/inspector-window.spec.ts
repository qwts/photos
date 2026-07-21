import { expect, test } from './support/app.js';

test('detached Inspector follows and pages the stable gallery selection (#503)', async ({ launchOverlook }) => {
  const { app, page } = await launchOverlook({ prefix: 'overlook-e2e-inspector-window-', env: { OVERLOOK_SEED: '4' } });
  await page.locator('.ovl-tile__img').first().waitFor();
  await page.getByRole('button', { name: 'Select IMG_4021.RAF' }).click();
  await page.getByRole('button', { name: 'Select IMG_4028.JPG' }).click();

  const opened = app.waitForEvent('window');
  await page.keyboard.press('ControlOrMeta+Shift+i');
  const inspector = await opened;
  await expect(inspector).toHaveURL(/surface=inspector/u);
  await expect(inspector.getByText('1 of 2 selected')).toBeVisible();
  await expect(inspector.getByTestId('inspector')).toContainText('IMG_4021.RAF');

  await inspector.getByRole('button', { name: 'Next selected photo' }).click();
  await expect(inspector.getByText('2 of 2 selected')).toBeVisible();
  await expect(inspector.getByTestId('inspector')).toContainText('IMG_4028.JPG');

  await inspector.close();
  await page.bringToFront();
  await page.keyboard.press('i');
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('IMG_4021.RAF');
});
