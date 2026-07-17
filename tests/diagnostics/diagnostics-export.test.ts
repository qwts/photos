import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { writeDiagnosticsExport } from '../../src/main/diagnostics/diagnostics-export.js';
import type { QueuedDiagnostic } from '../../src/main/diagnostics/diagnostics-queue.js';

const payload =
  '{"schemaVersion":1,"eventId":"98f581d6-ef9a-45e2-ae19-8b90099aef2e","capturedAt":"2026-07-17T10:00:00.000Z","appVersion":"0.27.0","platform":"darwin","arch":"arm64","kind":"main-process-runtime-error"}';

function report(): QueuedDiagnostic {
  return {
    event: JSON.parse(payload) as QueuedDiagnostic['event'],
    payload,
    encryptedBytes: 256,
  };
}

describe('diagnostics export (#286)', () => {
  test('writes the exact reviewed payload as JSONL', () => {
    const destination = join(mkdtempSync(join(tmpdir(), 'overlook-diagnostics-export-')), 'reports.jsonl');
    writeDiagnosticsExport(destination, [report(), report()]);
    assert.equal(readFileSync(destination, 'utf8'), `${payload}\n${payload}\n`);
  });

  test('an empty queue produces an empty export without synthetic metadata', () => {
    const destination = join(mkdtempSync(join(tmpdir(), 'overlook-diagnostics-export-')), 'reports.jsonl');
    writeDiagnosticsExport(destination, []);
    assert.equal(readFileSync(destination, 'utf8'), '');
  });
});
