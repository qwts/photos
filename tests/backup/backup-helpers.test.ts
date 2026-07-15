import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';

import { createBackupAuditLogger } from '../../src/main/backup/backup-audit.js';
import { sealManifestJson } from '../../src/main/backup/manifest-sealer.js';
import { createDecryptStream, type EnvelopeKey } from '../../src/main/crypto/envelope.js';

test('manifest helper seals authenticated JSON for the manifest context', async () => {
  const key: EnvelopeKey = { id: 1, key: randomBytes(32) };
  const json = JSON.stringify({ schema: 2, photos: [] });
  const sealed = await sealManifestJson(json, key);
  const opened = await buffer(Readable.from([sealed]).pipe(createDecryptStream(() => key.key, { photoId: 'manifest' })));

  assert.equal(opened.toString('utf8'), json);
});

test('backup audit helper appends timestamped evidence without blocking callers', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'overlook-audit-')), 'backup-audit.log');
  const audit = createBackupAuditLogger(path);
  audit('INTEGRITY-REPAIRED photo=P1');
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const contents = readFileSync(path, 'utf8');
      assert.match(contents, /^\d{4}-\d{2}-\d{2}T.* INTEGRITY-REPAIRED photo=P1\n$/u);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assert.fail('audit append did not complete');
});
