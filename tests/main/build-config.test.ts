import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bundledGoogleDriveClientId, bundledGoogleDriveClientSecret } from '../../src/main/build-config.js';

test('unconfigured Google Drive build credentials fail closed', () => {
  assert.equal(bundledGoogleDriveClientId(), null);
  assert.equal(bundledGoogleDriveClientSecret(), null);
});
