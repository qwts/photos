import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';

import { BackupIntegrityScrubber, type BackupIntegrityCursor, type BackupIntegrityItem } from '../../src/main/backup/integrity-scrubber.js';
import { MockProvider } from '../../src/main/backup/mock-provider.js';

const HASH_A = 'aa'.repeat(32);
const HASH_B = 'bb'.repeat(32);
const HASH_C = 'cc'.repeat(32);

function remotePath(hash: string): string {
  return `blobs/${hash.slice(0, 2)}/${hash}`;
}

test('bounded scrub repairs local-backed remote damage and resumes from its persisted cursor (#302)', async () => {
  const provider = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-integrity-remote-')) });
  const local = new Map([
    [HASH_A, Buffer.from('ciphertext-a')],
    [HASH_B, Buffer.from('ciphertext-b')],
    [HASH_C, Buffer.from('ciphertext-c')],
  ]);
  const items: BackupIntegrityItem[] = [HASH_A, HASH_B, HASH_C].map((contentHash, index) => ({
    id: `P${String(index + 1)}`,
    contentHash,
    syncState: 'synced',
  }));
  await provider.put(remotePath(HASH_A), Readable.from([local.get(HASH_A) ?? Buffer.alloc(0)]));
  await provider.put(remotePath(HASH_B), Readable.from([Buffer.from('corrupt remote bytes')]));
  let cursor: BackupIntegrityCursor = { version: 1, afterId: null, completedAt: null };
  const saved: BackupIntegrityCursor[] = [];
  const audits: string[] = [];
  const scrubber = new BackupIntegrityScrubber({
    provider,
    batchSize: 2,
    items: ({ afterId, limit }) => items.filter((item) => afterId === null || item.id > afterId).slice(0, limit),
    hasLocal: (hash) => local.has(hash),
    encryptedStream: (hash) => Readable.from([local.get(hash) ?? Buffer.alloc(0)]),
    verifyRemoteCiphertext: () => Promise.resolve(true),
    markUnrecoverable: () => undefined,
    cursor: {
      load: () => Promise.resolve(cursor),
      save: (next) => {
        cursor = next;
        saved.push(next);
        return Promise.resolve();
      },
    },
    audit: (line) => audits.push(line),
    now: () => new Date('2026-07-15T03:00:00.000Z'),
  });

  assert.deepEqual(await scrubber.scrub(), { checked: 2, repaired: 1, unrecoverable: 0, cycleComplete: false });
  assert.equal(cursor.afterId, 'P2');
  assert.deepEqual(await buffer(await provider.getStream(remotePath(HASH_B))), local.get(HASH_B));

  assert.deepEqual(await scrubber.scrub(), { checked: 1, repaired: 1, unrecoverable: 0, cycleComplete: true });
  assert.deepEqual(cursor, { version: 1, afterId: null, completedAt: '2026-07-15T03:00:00.000Z' });
  assert.deepEqual(await buffer(await provider.getStream(remotePath(HASH_C))), local.get(HASH_C));
  assert.ok(saved.length >= 3, 'progress is saved during the bounded walk');
  assert.ok(audits.some((line) => line.includes(`INTEGRITY-REPAIRED photo=P2 hash=${HASH_B}`)));
  assert.ok(audits.some((line) => line.includes(`INTEGRITY-REPAIRED photo=P3 hash=${HASH_C}`)));
});

test('remote-only missing or corrupt objects become explicit unrecoverable errors (#302)', async () => {
  const provider = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-integrity-offloaded-')) });
  const items: BackupIntegrityItem[] = [
    { id: 'P1', contentHash: HASH_A, syncState: 'offloaded' },
    { id: 'P2', contentHash: HASH_B, syncState: 'offloaded' },
  ];
  await provider.put(remotePath(HASH_B), Readable.from([Buffer.from('corrupt envelope')]));
  const marked: string[] = [];
  const scrubber = new BackupIntegrityScrubber({
    provider,
    batchSize: 10,
    items: ({ afterId, limit }) => items.filter((item) => afterId === null || item.id > afterId).slice(0, limit),
    hasLocal: () => false,
    encryptedStream: () => {
      throw new Error('remote-only rows have no local stream');
    },
    verifyRemoteCiphertext: (_item, ciphertext) => buffer(ciphertext).then((bytes) => bytes.equals(Buffer.from('valid envelope'))),
    markUnrecoverable: (photoId) => marked.push(photoId),
    cursor: {
      load: () => Promise.resolve({ version: 1, afterId: null, completedAt: null }),
      save: () => Promise.resolve(),
    },
    audit: () => undefined,
    now: () => new Date('2026-07-15T03:00:00.000Z'),
  });

  assert.deepEqual(await scrubber.scrub(), { checked: 2, repaired: 0, unrecoverable: 2, cycleComplete: true });
  assert.deepEqual(marked, ['P1', 'P2']);
});
