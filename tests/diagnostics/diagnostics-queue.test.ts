import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { DiagnosticsCustodyError, DiagnosticsQueue } from '../../src/main/diagnostics/diagnostics-queue.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

const NOW = Date.parse('2026-07-17T10:00:00.000Z');

function event(eventId: string, capturedAt = new Date(NOW).toISOString()) {
  return {
    schemaVersion: 1,
    eventId,
    capturedAt,
    appVersion: '0.27.0',
    platform: 'darwin',
    arch: 'arm64',
    kind: 'renderer-process-gone',
    reason: 'crashed',
    exitCode: 5,
  };
}

function cipher(calls?: { encrypt: number; decrypt: number }): SafeStorageLike {
  const pad = 0xa7;
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      if (calls !== undefined) calls.encrypt += 1;
      return Buffer.from(Buffer.from(plain).map((byte) => byte ^ pad));
    },
    decryptString: (sealed) => {
      if (calls !== undefined) calls.decrypt += 1;
      return Buffer.from(sealed.map((byte) => byte ^ pad)).toString('utf8');
    },
  };
}

describe('encrypted diagnostics queue (#286)', () => {
  test('opt-out collects nothing and immediately purges pending custody without decrypting it', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-diagnostics-'));
    const calls = { encrypt: 0, decrypt: 0 };
    const queue = new DiagnosticsQueue({ dataDir, safeStorage: cipher(calls), now: () => NOW });
    assert.equal(queue.enqueue(true, event('98f581d6-ef9a-45e2-ae19-8b90099aef2e')), true);
    const decryptsBeforeOptOut = calls.decrypt;
    assert.equal(queue.enqueue(false, event('804297bf-8166-4e54-b7ea-995e1087e3cf')), false);
    assert.deepEqual(queue.list(false), []);
    assert.equal(calls.encrypt, 1);
    assert.equal(calls.decrypt, decryptsBeforeOptOut);
    assert.equal(existsSync(dataDir), false);
  });

  test('stores only ciphertext and exposes the exact restart-stable payload for inspection/upload', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-diagnostics-'));
    const first = new DiagnosticsQueue({ dataDir, safeStorage: cipher(), now: () => NOW });
    const input = event('98f581d6-ef9a-45e2-ae19-8b90099aef2e');
    assert.equal(first.enqueue(true, input), true);
    const [name] = readdirSync(dataDir);
    if (name === undefined) throw new Error('expected an encrypted diagnostic file');
    assert.ok(name.endsWith('.diagnostic'));
    assert.equal(readFileSync(join(dataDir, name)).includes(Buffer.from('renderer-process-gone')), false);

    const restarted = new DiagnosticsQueue({ dataDir, safeStorage: cipher(), now: () => NOW });
    const [queued] = restarted.list(true);
    assert.deepEqual(queued?.event, input);
    assert.deepEqual(JSON.parse(queued?.payload ?? ''), input);
    assert.equal(restarted.enqueue(true, input), false, 'event identity is replay-safe');
  });

  test('prunes expired, corrupt, and oldest reports to the configured bounds', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-diagnostics-'));
    const queue = new DiagnosticsQueue({
      dataDir,
      safeStorage: cipher(),
      now: () => NOW,
      maxReports: 2,
      maxBytes: 1024 * 1024,
      maxAgeMs: 60_000,
    });
    queue.enqueue(true, event('98f581d6-ef9a-45e2-ae19-8b90099aef2e', '2026-07-17T09:00:00.000Z'));
    queue.enqueue(true, event('804297bf-8166-4e54-b7ea-995e1087e3cf', '2026-07-17T09:59:30.000Z'));
    queue.enqueue(true, event('cc384134-205d-462c-9f85-155b6ceafe3d', '2026-07-17T09:59:40.000Z'));
    queue.enqueue(true, event('ecec9ef7-1363-4b4e-a211-71ada9ff493d', '2026-07-17T09:59:50.000Z'));
    writeFileSync(join(dataDir, '00000000-0000-4000-8000-000000000000.diagnostic'), 'corrupt');

    assert.deepEqual(
      queue.list(true).map(({ event: queued }) => queued.eventId),
      ['cc384134-205d-462c-9f85-155b6ceafe3d', 'ecec9ef7-1363-4b4e-a211-71ada9ff493d'],
    );
    assert.equal(readdirSync(dataDir).length, 2);
  });

  test('fails closed instead of writing plaintext when OS encryption is unavailable', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-diagnostics-'));
    const unavailable: SafeStorageLike = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from('must not run'),
      decryptString: () => 'must not run',
    };
    const queue = new DiagnosticsQueue({ dataDir, safeStorage: unavailable, now: () => NOW });
    assert.throws(() => queue.enqueue(true, event('98f581d6-ef9a-45e2-ae19-8b90099aef2e')), DiagnosticsCustodyError);
    assert.deepEqual(readdirSync(dataDir), []);
  });
});
