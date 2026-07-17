import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeDiagnosticEvent } from '../../src/main/diagnostics/event-contract.js';

const safeEvent = {
  schemaVersion: 1,
  eventId: '98f581d6-ef9a-45e2-ae19-8b90099aef2e',
  capturedAt: '2026-07-17T09:00:00.000Z',
  appVersion: '0.27.0',
  platform: 'darwin',
  arch: 'arm64',
  kind: 'renderer-process-gone',
  reason: 'crashed',
  exitCode: 5,
} as const;

describe('diagnostics event privacy contract (#286)', () => {
  test('serializes only the versioned process-health vocabulary', () => {
    assert.deepEqual(JSON.parse(serializeDiagnosticEvent(safeEvent)), safeEvent);
  });

  test('fails closed when any unknown or sensitive field reaches serialization', () => {
    const canaries = {
      photoBytes: 'ffd8ffe000104a464946',
      thumbnail: 'UklGRiQAAABXRUJQVlA4',
      exif: 'Canon EOS R5 GPS 41.8781,-87.6298',
      filename: 'private-family-photo.jpg',
      libraryId: '01JPRIVATE-LIBRARY',
      localPath: '/Users/private/Pictures/private-family-photo.jpg',
      searchText: 'medical diagnosis',
      oauthToken: 'ya29.private-token',
      encryptionKey: 'private-master-key',
      faceData: [0.125, 0.25, 0.5],
    };

    for (const [field, value] of Object.entries(canaries)) {
      assert.throws(() => serializeDiagnosticEvent({ ...safeEvent, [field]: value }), field);
    }
  });

  test('rejects arbitrary messages and stacks instead of attempting blacklist redaction', () => {
    assert.throws(() => serializeDiagnosticEvent({ ...safeEvent, message: 'failed at /Users/private/Pictures' }));
    assert.throws(() => serializeDiagnosticEvent({ ...safeEvent, stack: 'Error at private-family-photo.jpg' }));
  });
});
