import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

const PASSWORD = 'Correct Horse Battery Staple 42!';

async function invokeMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu }, commandId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(commandId);
    if (item?.click === undefined) throw new Error(`menu item unavailable: ${commandId}`);
    Reflect.apply(item.click, item, [
      item,
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
      { triggeredByAccelerator: false },
    ]);
  }, id);
}

async function menuState(app: ElectronApplication, id: string): Promise<{ enabled: boolean; checked: boolean }> {
  return app.evaluate(({ Menu }, commandId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(commandId);
    if (item === null || item === undefined) throw new Error(`menu item unavailable: ${commandId}`);
    return { enabled: item.enabled, checked: item.checked };
  }, id);
}

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '3',
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_APP_LOCK_TEST_ANCHOR: '1',
    },
  });
}

test('native menu routes the focused window and revalidates checked, modal, target, and work state (#531)', async () => {
  const app = await launch(mkE2eTmpDir('overlook-e2e-application-menu-'));
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    await expect.poll(() => menuState(app, 'app.settings.open')).toMatchObject({ enabled: true });
    await expect.poll(() => menuState(app, 'photo.trash')).toMatchObject({ enabled: false });

    // Activity is reachable only from the Help menu (#690) — never a sidebar row.
    await expect(page.locator('.ovl-sidebar').getByRole('button', { name: 'Activity' })).toHaveCount(0);
    await expect.poll(() => menuState(app, 'help.activity')).toMatchObject({ enabled: true });
    await invokeMenu(app, 'help.activity');
    await expect(page.getByRole('dialog', { name: 'Activity' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Activity' })).toBeHidden();

    await invokeMenu(app, 'app.settings.open.privacy');
    await expect(page.getByTestId('settings-pane')).toHaveAttribute('data-section', 'privacy');
    await invokeMenu(app, 'app.settings.open.storage');
    await expect(page.getByTestId('settings-pane')).toHaveAttribute('data-section', 'storage');
    await invokeMenu(app, 'app.settings.open.storage');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(1);
    await invokeMenu(app, 'app.settings.open');
    await expect(page.getByTestId('settings-pane')).toHaveAttribute('data-section', 'general');
    await page.keyboard.press('Escape');

    await page.locator('.ovl-tile__img').first().waitFor();
    await page.locator('.ovl-grid__cell').first().click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await expect(page.getByTestId('lightbox').getByRole('button', { name: 'Favorite' })).toHaveClass(/ovl-icon-button--active/u);
    await expect.poll(() => menuState(app, 'photo.trash')).toMatchObject({ enabled: true });
    await invokeMenu(app, 'photo.favorite.toggle');
    await expect(page.getByTestId('lightbox').getByRole('button', { name: 'Favorite' })).not.toHaveClass(/ovl-icon-button--active/u);

    await invokeMenu(app, 'app.settings.open.privacy');
    await expect(page.getByTestId('lightbox')).toBeHidden();
    await expect(page.getByTestId('settings-pane')).toHaveAttribute('data-section', 'privacy');
    await invokeMenu(app, 'library.source.favorites');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
    await expect.poll(() => menuState(app, 'library.source.favorites')).toMatchObject({ checked: true });

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
    await invokeMenu(app, 'app.settings.open.transfer');
    await expect(page.getByTestId('settings-pane')).toHaveAttribute('data-section', 'transfer');
  } finally {
    await app.close();
  }
});

test('lock-safe Settings commands wait without exposing content, then open after unlock (#531)', async () => {
  const app = await launch(mkE2eTmpDir('overlook-e2e-application-menu-lock-'));
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    const configuring = page
      .evaluate(`window.overlook.appLock.configure({ password: ${JSON.stringify(PASSWORD)} })`)
      .catch(() => undefined);
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await configuring;
    await expect.poll(() => menuState(app, 'app.settings.open.privacy')).toMatchObject({ enabled: true });
    await expect.poll(() => menuState(app, 'library.import')).toMatchObject({ enabled: false });

    await invokeMenu(app, 'app.settings.open.privacy');
    await expect(page.getByTestId('virtual-grid')).toHaveCount(0);
    await page.getByLabel('App password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('settings-pane')).toHaveAttribute('data-section', 'privacy');
  } finally {
    await app.close();
  }
});

test('macOS menu recreates one primary window and delivers the queued route (#531)', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps the app alive with no windows');
  const app = await launch(mkE2eTmpDir('overlook-e2e-application-menu-window-'));
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.windows().length).toBe(0);
    await invokeMenu(app, 'app.settings.open.privacy');
    await expect.poll(() => app.windows().length).toBe(1);
    const replacement = app.windows()[0];
    if (replacement === undefined) throw new Error('replacement window missing');
    await expect(replacement.getByTestId('settings-pane')).toHaveAttribute('data-section', 'privacy');
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
  }
});
