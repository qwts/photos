import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRestoreFacade } from '../../src/main/backup/restore-facade.js';
import type { RestoreCoordinator, RestoreKeySource } from '../../src/main/backup/restore-coordinator.js';

// #741: the facade maps the IPC key argument onto the coordinator's key
// source — 'local-master' must never touch the recovery-key file path — and
// gates runs behind the provider-work lock.

function harness(busy = false) {
  const calls: { discovered: [string, RestoreKeySource][]; ran: string[] } = { discovered: [], ran: [] };
  const coordinator = {
    discoverFrom: (providerId: string, source: RestoreKeySource) => {
      calls.discovered.push([providerId, source]);
      return Promise.resolve({ sessionId: 's1', libraries: [], error: null });
    },
    run: (sessionId: string) => {
      calls.ran.push(sessionId);
      return Promise.resolve({ result: null, error: null });
    },
    cancel: () => undefined,
  } as unknown as RestoreCoordinator;
  const facade = createRestoreFacade({
    coordinator: () => coordinator,
    fresh: () => true,
    pickKey: () => Promise.resolve('/tmp/key.ovrk'),
    busy: () => busy,
  });
  return { facade, calls };
}

test("'local-master' reaches the coordinator as the local key source (#741)", async () => {
  const { facade, calls } = harness();
  await facade.discover('pcloud', 'local-master');
  assert.deepEqual(calls.discovered, [['pcloud', { kind: 'local-master' }]]);
});

test('a recovery-key request carries path and password through unchanged', async () => {
  const { facade, calls } = harness();
  await facade.discover('pcloud', { keyPath: '/keys/r.ovrk', password: 'pw' });
  assert.deepEqual(calls.discovered, [['pcloud', { kind: 'recovery-key', path: '/keys/r.ovrk', password: 'pw' }]]);
});

test('runs are refused while provider work is active; idle runs delegate', async () => {
  const blocked = harness(true);
  const refused = await blocked.facade.run('s1', 'L1', false);
  assert.equal(refused.error?.reason, 'io');
  assert.deepEqual(blocked.calls.ran, []);

  const idle = harness(false);
  await idle.facade.run('s1', 'L1', false);
  assert.deepEqual(idle.calls.ran, ['s1']);
  assert.deepEqual(idle.facade.profileStatus(), { fresh: true });
  assert.equal(await idle.facade.pickKey(), '/tmp/key.ovrk');
});
