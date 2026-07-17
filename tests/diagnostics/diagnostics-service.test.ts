import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { DiagnosticsQueue } from '../../src/main/diagnostics/diagnostics-queue.js';
import { DiagnosticsService, type DiagnosticsFailureCode } from '../../src/main/diagnostics/diagnostics-service.js';

const NOW = new Date('2026-07-17T10:00:00.000Z');
const EVENT_ID = '98f581d6-ef9a-45e2-ae19-8b90099aef2e';

function cipher(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain).map((byte) => byte ^ 0xa7)),
    decryptString: (sealed) => Buffer.from(sealed.map((byte) => byte ^ 0xa7)).toString('utf8'),
  };
}

function world(consent: { value: boolean }, overrides: Partial<ConstructorParameters<typeof DiagnosticsService>[0]> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'overlook-diagnostics-service-'));
  const failures: DiagnosticsFailureCode[] = [];
  const service = new DiagnosticsService({
    queue: new DiagnosticsQueue({ dataDir, safeStorage: cipher(), now: () => NOW.getTime() }),
    settings: () => ({ shareDiagnostics: consent.value }),
    eventId: () => EVENT_ID,
    now: () => NOW,
    appVersion: '0.27.0',
    platform: 'darwin',
    arch: 'arm64',
    failure: (code) => failures.push(code),
    ...overrides,
  });
  return { dataDir, failures, service };
}

describe('diagnostics consent and capture service (#286)', () => {
  test('opt-out creates no event identity, timestamp, encryption, or disk custody', () => {
    const consent = { value: false };
    let touched = false;
    const { dataDir, service } = world(consent, {
      eventId: () => {
        touched = true;
        return EVENT_ID;
      },
      now: () => {
        touched = true;
        return NOW;
      },
    });

    assert.equal(service.record({ kind: 'renderer-process-gone', reason: 'crashed', exitCode: 5 }), false);
    assert.equal(touched, false);
    assert.equal(existsSync(dataDir), false);
  });

  test('opt-in records only closed process-health fields and exposes exact payload', () => {
    const consent = { value: true };
    const { service } = world(consent);
    assert.equal(service.record({ kind: 'renderer-process-gone', reason: 'crashed', exitCode: 5 }), true);
    const [queued] = service.list();
    assert.deepEqual(queued?.event, {
      schemaVersion: 1,
      eventId: EVENT_ID,
      capturedAt: NOW.toISOString(),
      appVersion: '0.27.0',
      platform: 'darwin',
      arch: 'arm64',
      kind: 'renderer-process-gone',
      reason: 'crashed',
      exitCode: 5,
    });
  });

  test('opting out purges the queue immediately during settings reconciliation', () => {
    const consent = { value: true };
    const { dataDir, service } = world(consent);
    service.record({ kind: 'main-process-runtime-error' });
    assert.equal(service.reconcileConsent(), 1);
    consent.value = false;
    assert.equal(service.reconcileConsent(), 0);
    assert.equal(existsSync(dataDir), false);
  });

  test('unknown Electron reason and unavailable custody fail closed with code-only reporting', () => {
    const consent = { value: true };
    const { failures, service } = world(consent, { platform: '/Users/private/Pictures' });
    assert.equal(service.record({ kind: 'renderer-process-gone', reason: 'crashed' }), false);
    assert.deepEqual(failures, ['invalid-event']);
    assert.deepEqual(service.list(), []);
  });

  test('review controls report exact deletion outcomes and purge counts', () => {
    const consent = { value: true };
    const { service } = world(consent);
    service.record({ kind: 'main-process-runtime-error' });
    assert.equal(service.remove('242b0f8a-c985-4a2e-951b-8d49ae3c2b17'), false);
    assert.equal(service.remove(EVENT_ID), true);
    service.record({ kind: 'main-process-runtime-error' });
    assert.equal(service.purge(), 1);
    assert.deepEqual(service.list(), []);
  });

  test('export is restricted to the immutable reviewed event-id snapshot', () => {
    const consent = { value: true };
    const secondId = '242b0f8a-c985-4a2e-951b-8d49ae3c2b17';
    const ids = [EVENT_ID, secondId];
    const { dataDir, service } = world(consent, { eventId: () => ids.shift() ?? secondId });
    service.record({ kind: 'main-process-runtime-error' });
    const reviewedPayload = service.list()[0]?.payload;
    service.record({ kind: 'renderer-unresponsive' });
    const destination = join(dataDir, 'reviewed.jsonl');

    assert.equal(service.export(destination, [EVENT_ID]), 1);
    assert.equal(readFileSync(destination, 'utf8'), `${reviewedPayload}\n`);
    assert.throws(() => service.export(destination, ['b3f71382-6a55-4491-b751-43855a292c63']));
  });
});
