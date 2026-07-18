import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// #240 exit criteria: the full recovery round trip across profiles — export
// a password-encrypted key backup on device A, restore A's encrypted
// library files onto a fresh device B (no master key), import the .key
// through the KeyDialog, and B decrypts A's photos on the next launch.
// Wrong password fails safely first, on the designed error copy.

const PASSWORD = 'Correct Horse Battery 9!';

async function launch(userData: string, extraEnv: Record<string, string> = {}) {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      ...extraEnv,
    },
  });
}

test('recovery key: export on A, import on restored B, library decrypts after relaunch', async () => {
  test.setTimeout(120_000); // two scrypt derivations (~1s each) + 3 app launches
  const userDataA = mkE2eTmpDir('overlook-e2e-keys-a-');
  const userDataB = mkE2eTmpDir('overlook-e2e-keys-b-');
  const keyFile = join(mkE2eTmpDir('overlook-e2e-keys-file-'), 'overlook-recovery.key');

  // Device A: seeded library; export the recovery key through the dialog.
  const appA = await launch(userDataA, { OVERLOOK_SEED: '2', OVERLOOK_KEY_EXPORT_DESTINATION: keyFile });
  let fingerprintA: string;
  try {
    const pageA = await appA.firstWindow();
    await pageA.getByTestId('virtual-grid').waitFor();
    await pageA.getByRole('button', { name: 'Settings' }).click();
    await pageA.getByRole('button', { name: 'Privacy' }).click();
    const row = pageA.getByTestId('recovery-key-row');
    await expect(row).toContainText(/[0-9A-F]{4}·[0-9A-F]{4}·[0-9A-F]{4}·[0-9A-F]{4}/u);
    fingerprintA = /([0-9A-F]{4}·[0-9A-F]{4}·[0-9A-F]{4}·[0-9A-F]{4})/u.exec((await row.textContent()) ?? '')?.[1] ?? '';
    expect(fingerprintA).not.toBe('');

    await pageA.getByRole('button', { name: 'Back up…' }).click();
    await pageA.getByLabel('New password').fill(PASSWORD);
    await pageA.getByLabel('Re-enter password').fill(PASSWORD);
    await pageA.getByText('I understand this password cannot be reset or recovered.').click();
    await pageA.getByRole('button', { name: 'Export key backup' }).click();
    await expect(pageA.getByText('Key backup saved.')).toBeVisible({ timeout: 30_000 });
    expect(existsSync(keyFile)).toBe(true);
    // Sanity: the sealed file never contains the plaintext master key — but
    // we can at least require it to be tiny and non-empty.
    expect(readFileSync(keyFile).length).toBeGreaterThan(60);
  } finally {
    await appA.close();
  }

  // Device B: A's encrypted library files, but NO master key — the restore
  // scenario. The first launch cannot open the library.
  cpSync(join(userDataA, 'library'), join(userDataB, 'library'), { recursive: true });
  rmSync(join(userDataB, 'library', 'master.key'));

  const appB = await launch(userDataB, { OVERLOOK_KEY_IMPORT_SOURCE: keyFile });
  try {
    const pageB = await appB.firstWindow();
    // The shell renders even though the library can't decrypt yet.
    await pageB.getByRole('button', { name: 'Settings' }).click();
    await pageB.getByRole('button', { name: 'Privacy' }).click();
    await pageB.getByRole('button', { name: 'Import…' }).click();
    await pageB.getByText('Choose or drop a .key file').click();
    await expect(pageB.getByTestId('key-file-card')).toContainText('overlook-recovery.key');

    // Wrong password fails safely on the designed copy; nothing installed.
    await pageB.getByLabel('Backup password').fill('not the password');
    await pageB.getByRole('button', { name: 'Unlock & import' }).click();
    await expect(pageB.getByRole('alert')).toContainText('Wrong password', { timeout: 30_000 });

    // Right password: installed, fingerprint matches device A's.
    await pageB.getByLabel('Backup password').fill(PASSWORD);
    await pageB.getByRole('button', { name: 'Unlock & import' }).click();
    await expect(pageB.getByText('Key unlocked and installed.')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByTestId('key-fingerprint')).toContainText(fingerprintA);
  } finally {
    await appB.close();
  }

  // Relaunch B: the restored library now decrypts — A's seeded photos render.
  const appB2 = await launch(userDataB);
  try {
    const pageB2 = await appB2.firstWindow();
    await pageB2.getByTestId('virtual-grid').waitFor();
    // OVERLOOK_SEED=2 seeds two photos on A — both must decrypt here.
    await expect(pageB2.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(2);
    // And the key custody is A's: same fingerprint in Settings.
    await pageB2.getByRole('button', { name: 'Settings' }).click();
    await pageB2.getByRole('button', { name: 'Privacy' }).click();
    await expect(pageB2.getByTestId('recovery-key-row')).toContainText(fingerprintA);
  } finally {
    await appB2.close();
  }
});
