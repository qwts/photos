import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bundledGoogleDriveClientId, bundledGoogleDriveClientSecret, pcloudFeatureConfig } from '../../src/main/build-config.js';

test('unconfigured Google Drive build credentials fail closed', () => {
  assert.equal(bundledGoogleDriveClientId(), null);
  assert.equal(bundledGoogleDriveClientSecret(), null);
});

test('pCloud requires both the opt-in flag and a supplied client ID', () => {
  assert.deepEqual(
    pcloudFeatureConfig(() => undefined),
    { enabled: false, clientId: null },
  );
  assert.deepEqual(
    pcloudFeatureConfig((name) => (name === 'OVERLOOK_PCLOUD_ENABLED' ? '1' : undefined)),
    {
      enabled: false,
      clientId: null,
    },
  );
  assert.deepEqual(
    pcloudFeatureConfig((name) =>
      name === 'OVERLOOK_PCLOUD_ENABLED' ? '1' : name === 'OVERLOOK_PCLOUD_CLIENT_ID' ? 'public-test-id' : undefined,
    ),
    { enabled: true, clientId: 'public-test-id' },
  );
});
