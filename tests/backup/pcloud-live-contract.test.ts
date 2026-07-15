import { test } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { startLoopbackCapture } from '../../src/main/backup/pcloud/loopback.js';
import { buildAuthorizeUrl } from '../../src/main/backup/pcloud/oauth.js';
import { PCloudProvider } from '../../src/main/backup/pcloud/pcloud-provider.js';
import { ProviderError } from '../../src/main/backup/provider.js';
import { ulid } from '../../src/main/import/ulid.js';
import { exerciseDisasterRecoveryContract } from './disaster-recovery-contract.js';
import { exerciseRestoreProviderContract } from './restore-provider-contract.js';

// The LIVE half of #109's exit criteria (#256): the provider contract from
// #103 exercised against real pCloud. Env-gated and interactive — NEVER in
// CI. Run with `npm run test:pcloud:live`; the test prints an authorize URL,
// the owner approves in a browser, and the loopback captures the token (no
// manual token handling). Work happens under a unique
// /Overlook/<unique-ulid>/ home; files are deleted afterward (the
// empty scratch folders linger — folder removal isn't part of the provider
// interface, and each run's ULID keeps them inert).

const LIVE = process.env['OVERLOOK_PCLOUD_LIVE'] === '1';

test(
  'LIVE pCloud contract: sign-in → put → list → get → verify → quota → delete (#256)',
  { skip: !LIVE, timeout: 10 * 60_000 },
  async () => {
    const state = randomBytes(16).toString('hex');
    const capture = startLoopbackCapture({ state, timeoutMs: 5 * 60_000 });
    await capture.listening;
    console.log('\n  ➜ Open this URL in your browser and approve pCloud access:\n');
    console.log(`    ${buildAuthorizeUrl(state)}\n`);
    const auth = await capture.result;
    console.log(`  ✓ token captured (region host: ${auth.apiHost})\n`);

    const libraryId = ulid();
    const provider = new PCloudProvider({
      auth: () => ({ ...auth, connectedAt: new Date().toISOString() }),
      libraryId,
    });

    const PAYLOAD = Buffer.from('OVLK-live-contract-payload');
    const blobPath = 'blobs/ab/abcdef123';
    await exerciseRestoreProviderContract(provider, libraryId);
    const recovered = await exerciseDisasterRecoveryContract(provider, libraryId);
    assert.deepEqual(recovered, { generation: 1, photos: 2 });
    try {
      const put = await provider.put(blobPath, Readable.from([PAYLOAD]));
      assert.equal(put.bytes, PAYLOAD.length, 'provider records the exact byte count');

      const listed = await provider.list('blobs');
      assert.deepEqual(listed, [{ path: blobPath, bytes: PAYLOAD.length }], 'listing mirrors the mock contract');

      const verified = await provider.verify(blobPath);
      assert.equal(verified.bytes, PAYLOAD.length);

      const quota = await provider.quota();
      assert.ok(quota.totalBytes > 0, 'quota reports the real plan size');
      assert.ok(quota.usedBytes >= 0 && quota.usedBytes <= quota.totalBytes);
    } finally {
      await provider.delete(blobPath);
    }

    await assert.rejects(
      provider.getStream(blobPath),
      (error: unknown) => error instanceof ProviderError && error.kind === 'not-found',
      'deleted entries read as not-found',
    );
    await assert.rejects(
      provider.put('a/../b', Readable.from([PAYLOAD])),
      (error: unknown) => error instanceof ProviderError && error.kind === 'corrupt',
      'unsafe paths are rejected before any network',
    );
    console.log('  ✓ live contract green — record this run on #109\n');
  },
);
