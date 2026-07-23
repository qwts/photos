import { mkE2eTmpDir } from './support/tmp-dir.js';
import { createInboundMoveFixture } from './support/inbound-move.js';
import { expect, test } from './support/app.js';

test('pCloud inbound Move imports once and restores its durable ACK status after restart', async ({ launchOverlook }) => {
  const fixtureRoot = mkE2eTmpDir('overlook-e2e-inbound-move-fixture-');
  const fixture = await createInboundMoveFixture(fixtureRoot);
  const launched = await launchOverlook({
    prefix: 'overlook-e2e-inbound-move-',
    env: {
      OVERLOOK_SEED: '4',
      OVERLOOK_INTEROP_PAIRING_BUNDLE: fixture.pairingBundle,
      OVERLOOK_INTEROP_PCLOUD_ROOT: fixture.providerRoot,
      OVERLOOK_PCLOUD_ENABLED: '1',
      OVERLOOK_PCLOUD_CLIENT_ID: 'public-e2e-client',
    },
  });

  const { page } = launched;
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Transfer & Sync' }).click();
  await expect(settings.getByTestId('interop-provider-card')).toContainText('connected');
  await settings.getByRole('button', { name: 'Select bundle…' }).click();
  await settings.getByLabel('Pairing bundle password').fill(fixture.password);
  await settings.getByRole('button', { name: 'Unlock for this session' }).click();
  await settings.getByRole('button', { name: 'Check for incoming transfers' }).click();
  await settings.getByRole('button', { name: 'Review 1 incoming item' }).click();

  const move = page.getByRole('dialog', { name: 'Move to Overlook' });
  await expect(move).toContainText('Eligible1');
  await move.getByRole('button', { name: 'Start move' }).click();
  await expect(move.locator('[data-phase="completed"]')).toBeVisible({ timeout: 30_000 });
  await expect(move).toContainText('1 acknowledged');

  const rows = await page.evaluate<{ id: string; fileName: string; importSource: string | null; takenAt: string | null }[]>(
    `window.overlook.library.page({ source: 'all', limit: 20 }).then((result) => result.photos)`,
  );
  expect(rows).toContainEqual(
    expect.objectContaining({
      id: fixture.photoId,
      fileName: 'Trail Summit.jpg',
      importSource: 'Image Trail interoperability',
      takenAt: null,
    }),
  );
  const acknowledgement = await fixture.acknowledgement();
  expect(acknowledgement.payload.kind).toBe('acknowledgement');
  if (acknowledgement.payload.kind !== 'acknowledgement') throw new Error('Expected acknowledgement payload.');
  expect(acknowledgement.payload.acknowledgedMessageIds).toEqual([
    '6af6239d-8ce9-4ac8-b9ca-ffb0e55635cf',
    'c8865ad8-8975-4abe-9a1c-bbde10a71efa',
  ]);

  await launched.close();
  const resumed = await launchOverlook({
    userData: launched.userData,
    env: {
      OVERLOOK_SEED: '4',
      OVERLOOK_INTEROP_PAIRING_BUNDLE: fixture.pairingBundle,
      OVERLOOK_INTEROP_PCLOUD_ROOT: fixture.providerRoot,
      OVERLOOK_PCLOUD_ENABLED: '1',
      OVERLOOK_PCLOUD_CLIENT_ID: 'public-e2e-client',
    },
  });
  await resumed.page.getByRole('button', { name: 'Settings' }).click();
  const resumedSettings = resumed.page.getByRole('dialog', { name: 'Settings' });
  await resumedSettings.getByRole('tab', { name: 'Transfer & Sync' }).click();
  await expect(resumedSettings.getByTestId('interop-pairing-card')).toContainText('locked');
  await resumedSettings.getByLabel('Pairing bundle password').fill(fixture.password);
  await resumedSettings.getByRole('button', { name: 'Unlock for this session' }).click();
  await resumedSettings.getByRole('button', { name: 'Check for incoming transfers' }).click();
  await resumedSettings.getByRole('button', { name: 'Review 1 incoming item' }).click();
  const resumedMove = resumed.page.getByRole('dialog', { name: 'Move to Overlook' });
  await expect(resumedMove.locator('[data-phase="completed"]')).toBeVisible();
  await expect(resumedMove).toContainText('1 / 1 · 1 acknowledged');
  await expect(resumedMove.getByRole('button', { name: 'Start move' })).toBeDisabled();
  const resumedRows = await resumed.page.evaluate<{ id: string }[]>(
    `window.overlook.library.page({ source: 'all', limit: 20 }).then((result) => result.photos)`,
  );
  expect(resumedRows.filter((row) => row.id === fixture.photoId)).toHaveLength(1);
  expect(await fixture.acknowledgementCount()).toBe(1);
});
