import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { OverlookApi } from '../../src/shared/ipc/api.js';

// #386: the switcher UI end-to-end — create a library in the modal and LAND
// in it, switch back with the keyboard only, and registry-only removal. The
// switch teardown/crash lanes stay in library-switch.spec.ts (#385).

function launch(userData: string, extra: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      ...extra,
    },
  });
}

test('ACCEPTANCE: create a library in the switcher and land in it; keyboard-only switch back shows everything again (#386)', async () => {
  test.setTimeout(90_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-switcher-ui-'));

  const app = await launch(userData, { OVERLOOK_SEED: '3' });
  try {
    let page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    // The titlebar trigger names the current library everywhere (#386).
    await expect(page.getByTestId('library-trigger')).toContainText('My Library');

    // Create "Studio" in the modal: name via keyboard, default location,
    // Enter submits the form (keyboard path through the create flow).
    await page.getByTestId('library-trigger').click();
    await expect(page.getByTestId('library-switcher')).toBeVisible();
    await expect(page.getByTestId('library-row-My Library')).toContainText('Open now');
    await page.getByTestId('new-library').click();
    await page.getByTestId('create-name').fill('Studio');
    await page.keyboard.press('Enter');

    // Acceptance 1: landed in the created library — empty grid, correct name.
    page = await app.firstWindow();
    await page.getByTestId('empty-state').waitFor();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(0);
    await expect(page.getByTestId('library-trigger')).toContainText('Studio');

    // Acceptance 2 + 4: switch back keyboard-only — open the switcher from
    // the focused trigger, arrow to the seeded library, Enter.
    await page.getByTestId('library-trigger').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('library-switcher')).toBeVisible();
    await expect(page.getByTestId('library-row-My Library')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('library-row-My Library')).toBeFocused();
    await page.keyboard.press('Enter');

    page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);
    await expect(page.getByTestId('library-trigger')).toContainText('My Library');
  } finally {
    await app.close();
  }
});

test('remove from list is registry-only in the UI: reassurance copy, row gone, files untouched (#386)', async () => {
  test.setTimeout(60_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-switcher-rm-'));

  const app = await launch(userData, { OVERLOOK_SEED: '1' });
  try {
    const page: Page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    // Register a second library without switching (IPC create keeps the UI
    // lane focused on the remove flow).
    const secondPath = await page.evaluate(async () => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      const { library } = await overlook.libraries.create({ name: 'Scratch', path: null });
      return library.path;
    });

    await page.getByTestId('library-trigger').click();
    await expect(page.getByTestId('library-list')).toContainText('Scratch');
    await page.getByRole('button', { name: 'Remove Scratch from list' }).click();
    await expect(page.getByText('Nothing is deleted. Your encrypted files stay on disk.')).toBeVisible();
    await page.getByTestId('remove-confirm').click();

    // Back on the list without the row; the directory survives on disk.
    await expect(page.getByTestId('library-list')).not.toContainText('Scratch');
    const survived = await page.evaluate(async (dir) => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      const outcome = await overlook.libraries.add({ path: dir });
      return outcome.ok;
    }, secondPath);
    expect(survived, 're-adding the removed directory proves its files were never touched').toBe(true);
    // The modal snapshots its list — reopen to see the re-added entry. An
    // app-managed directory re-registers under its basename (the ULID), so
    // the stable assertion is the path.
    await page.keyboard.press('Escape');
    await page.getByTestId('library-trigger').click();
    await expect(page.getByTestId('library-list')).toContainText(secondPath);
  } finally {
    await app.close();
  }
});
