import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { schemePrivilegeContract } from '../../src/main/protocol-privilege-contract.js';
import { FULL_SCHEME } from '../../src/shared/library/full-url.js';
import { THUMB_SCHEME } from '../../src/shared/library/thumb-url.js';

describe('custom protocol privilege contract', () => {
  test('grants thumbnails only the privileges needed by image elements', () => {
    const thumb = schemePrivilegeContract.find(({ scheme }) => scheme === THUMB_SCHEME);

    assert.deepEqual(thumb, {
      scheme: THUMB_SCHEME,
      privileges: { standard: true, stream: true },
    });
    assert.equal('supportFetchAPI' in (thumb?.privileges ?? {}), false);
    assert.equal('corsEnabled' in (thumb?.privileges ?? {}), false);
  });

  test('retains fetch and CORS privileges required by full-image prefetch', () => {
    const full = schemePrivilegeContract.find(({ scheme }) => scheme === FULL_SCHEME);

    assert.deepEqual(full, {
      scheme: FULL_SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true },
    });
  });

  test('registers each custom scheme exactly once', () => {
    assert.equal(new Set(schemePrivilegeContract.map(({ scheme }) => scheme)).size, schemePrivilegeContract.length);
  });
});
