import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { configureAppProfile } from '../../src/main/app-profile.js';
import { OVERLOOK_PRODUCT_NAME } from '../../src/shared/app-identity.js';

function profileApp(isPackaged = false): {
  app: Parameters<typeof configureAppProfile>[0];
  calls: string[];
} {
  const calls: string[] = [];
  return {
    app: {
      isPackaged,
      setName: (name) => calls.push(`name:${name}`),
      setPath: (name, value) => calls.push(`path:${name}:${value}`),
    },
    calls,
  };
}

describe('app profile identity', () => {
  it('sets the stable product name before an unpackaged profile override', () => {
    const { app, calls } = profileApp();

    assert.equal(configureAppProfile(app, '/tmp/overlook-profile'), '/tmp/overlook-profile');
    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`, 'path:userData:/tmp/overlook-profile']);
  });

  it('ignores profile overrides in packaged builds', () => {
    const { app, calls } = profileApp(true);

    assert.equal(configureAppProfile(app, '/tmp/overlook-profile'), undefined);
    assert.deepEqual(calls, [`name:${OVERLOOK_PRODUCT_NAME}`]);
  });
});
