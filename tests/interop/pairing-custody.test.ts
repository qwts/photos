import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createInteropPairingBundle } from '../../src/main/interop/pairing.js';
import { InteropPairingBundleStore, InteropPairingCustodian, InteropPairingCustodyError } from '../../src/main/interop/pairing-custody.js';

function profile(name: string): string {
  return mkdtempSync(join(tmpdir(), `overlook-interop-pairing-${name}-`));
}

test('protected pairing persists across restart and unlocks once per session', async () => {
  const directory = profile('restart');
  const bundle = await createInteropPairingBundle('pairing-password');
  const first = new InteropPairingCustodian(new InteropPairingBundleStore(directory));
  assert.equal(first.replace(bundle).status, 'locked');
  const password = Buffer.from('pairing-password');
  assert.equal((await first.unlock(password)).status, 'unlocked');
  assert.ok(
    password.every((byte) => byte === 0),
    'one-shot password bytes were cleared',
  );
  assert.equal(
    first.withUnlocked((custody) => custody.interopKey.byteLength),
    32,
  );

  const stored = readFileSync(join(directory, 'interop', 'pairing-bundle.json'), 'utf8');
  assert.doesNotMatch(stored, /pairing-password/u);
  assert.doesNotMatch(stored, /interopKey/u);

  const restarted = new InteropPairingCustodian(new InteropPairingBundleStore(directory));
  assert.equal(restarted.state().status, 'locked');
  assert.throws(() => restarted.withUnlocked(() => undefined), InteropPairingCustodyError);
});

test('wrong password, replacement, and lifecycle lock clear key custody', async () => {
  const custodian = new InteropPairingCustodian(new InteropPairingBundleStore(profile('lifecycle')));
  const first = await createInteropPairingBundle('correct-password');
  custodian.replace(first);
  const wrong = Buffer.from('wrong-password');
  await assert.rejects(custodian.unlock(wrong), /Unable to unlock/u);
  assert.ok(wrong.every((byte) => byte === 0));
  assert.equal(custodian.state().status, 'locked');

  await custodian.unlock(Buffer.from('correct-password'));
  const retained = custodian.withUnlocked((custody) => custody.interopKey);
  custodian.lock();
  assert.ok(
    retained.every((byte) => byte === 0),
    'lock zeroized the retained key buffer',
  );

  await custodian.unlock(Buffer.from('correct-password'));
  const replaced = custodian.withUnlocked((custody) => custody.interopKey);
  custodian.replace(await createInteropPairingBundle('replacement-password'));
  assert.ok(
    replaced.every((byte) => byte === 0),
    'replacement zeroized prior key custody',
  );
  assert.equal(custodian.state().status, 'locked');
  assert.throws(
    () => custodian.replace({ password: 'do-not-leak' }),
    (error: unknown) => {
      return error instanceof InteropPairingCustodyError && error.message === 'Selected interoperability pairing bundle is invalid.';
    },
  );
});
