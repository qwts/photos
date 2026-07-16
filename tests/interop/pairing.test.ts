import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { createInteropPairingBundle, InteropPairingError, openInteropPairingBundle } from '../../src/main/interop/pairing.js';
import { INTEROP_PAIRING_PBKDF2_ITERATIONS, interopPairingBundleSchema } from '../../src/shared/interop/pairing-contract.js';

const deterministicOptions = {
  now: '2026-07-16T10:00:00.000Z',
  pairingId: 'a3267e90-2bd1-432c-bc8b-78e4704f843f',
  keyId: 'interop:0de6557b-a17d-4e36-99f0-c20e64f021de',
  salt: Buffer.from([...Array.from({ length: 16 }).keys()]),
  iv: Buffer.from([...Array.from({ length: 12 }, (_value, index) => index + 16)]),
  interopKey: Buffer.from([...Array.from({ length: 32 }, (_value, index) => index + 32)]),
};

function pairingFixture(name = 'valid-pairing-bundle.json'): unknown {
  return JSON.parse(readFileSync(`design/handoff/contracts/v1/fixtures/${name}`, 'utf8')) as unknown;
}

describe('interoperability pairing bundle', () => {
  test('round-trips a random interoperability key through the canonical password bundle', async () => {
    const bundle = await createInteropPairingBundle('fixture-password', deterministicOptions);
    assert.deepEqual(bundle, pairingFixture());
    assert.equal(interopPairingBundleSchema.safeParse(bundle).success, true);
    assert.equal(bundle.kdf.iterations, INTEROP_PAIRING_PBKDF2_ITERATIONS);
    const opened = await openInteropPairingBundle(bundle, 'fixture-password');
    assert.equal(opened.pairingId, deterministicOptions.pairingId);
    assert.equal(opened.keyId, deterministicOptions.keyId);
    assert.deepEqual(opened.interopKey, deterministicOptions.interopKey);
  });

  test('uses fresh identifiers, salts, IVs, keys, and ciphertext by default', async () => {
    const first = await createInteropPairingBundle('password');
    const second = await createInteropPairingBundle('password');
    assert.notEqual(first.pairingId, second.pairingId);
    assert.notEqual(first.keyId, second.keyId);
    assert.notEqual(first.kdf.salt, second.kdf.salt);
    assert.notEqual(first.cipher.iv, second.cipher.iv);
    assert.notEqual(first.cipher.ciphertext, second.cipher.ciphertext);
  });

  test('fails closed for a wrong password and authenticated-header or ciphertext tampering', async () => {
    const bundle = await createInteropPairingBundle('correct-password', deterministicOptions);
    await assert.rejects(openInteropPairingBundle(bundle, 'wrong-password'), /Unable to open pairing bundle/);
    await assert.rejects(
      openInteropPairingBundle({ ...bundle, pairingId: 'd4dfe780-0a62-4337-b768-bdf7982503c4' }, 'correct-password'),
      /Unable to open pairing bundle/,
    );
    const ciphertext = Buffer.from(bundle.cipher.ciphertext, 'base64');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await assert.rejects(
      openInteropPairingBundle({ ...bundle, cipher: { ...bundle.cipher, ciphertext: ciphertext.toString('base64') } }, 'correct-password'),
      /Unable to open pairing bundle/,
    );
  });

  test('rejects the golden corrupt pairing bundle', async () => {
    await assert.rejects(
      openInteropPairingBundle(pairingFixture('corrupt-pairing-bundle.json'), 'fixture-password'),
      /Unable to open pairing bundle/,
    );
  });

  test('rejects blank passwords, malformed key material, and unsupported versions', async () => {
    await assert.rejects(createInteropPairingBundle(''), /Pairing password is required/);
    await assert.rejects(
      createInteropPairingBundle('password', { ...deterministicOptions, interopKey: randomBytes(31) }),
      /Interoperability key must be 32 bytes/,
    );
    const bundle = await createInteropPairingBundle('password', deterministicOptions);
    await assert.rejects(openInteropPairingBundle({ ...bundle, formatVersion: 2 }, 'password'), (error: unknown) => {
      assert.ok(error instanceof InteropPairingError);
      assert.match(error.message, /Unsupported pairing bundle version/);
      return true;
    });
  });

  test('normalizes equivalent Unicode passwords for browser and Node parity', async () => {
    const bundle = await createInteropPairingBundle('Cafe\u0301', deterministicOptions);
    const opened = await openInteropPairingBundle(bundle, 'Caf\u00e9');
    assert.deepEqual(opened.interopKey, deterministicOptions.interopKey);
  });
});
