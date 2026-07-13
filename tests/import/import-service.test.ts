import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ImportService } from '../../src/main/import/import-service.js';
import type { ImportEngine, ImportSummary } from '../../src/main/import/import-engine.js';
import type { PhotosRepository } from '../../src/main/db/photos-repository.js';

// The service owns "one journal, one writer" (#87, PR #183 review): batches
// and resumes never overlap, whatever order callers fire them in.

function fakeRepo(): PhotosRepository {
  return { hasContentHash: () => false } as unknown as PhotosRepository;
}

const IDLE_EVENTS = {
  scanProgress: () => undefined,
  copyProgress: () => undefined,
  thumbProgress: () => undefined,
  imported: () => undefined,
};

describe('import service serialization (#87)', () => {
  test('overlapping run()/resume() calls execute strictly in turn', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'overlook-src-'));
    writeFileSync(join(sourceDir, 'a.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    let active = 0;
    let peak = 0;
    const enter = async (): Promise<ImportSummary> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { imported: 0, duplicates: 0, failed: 0, cancelled: 0, photoIds: [] };
    };
    const engine = {
      importFiles: enter,
      resume: async () => enter(),
    } as unknown as ImportEngine;

    const service = new ImportService(fakeRepo(), IDLE_EVENTS, engine);
    await Promise.all([service.run(sourceDir, 'copy'), service.run(sourceDir, 'copy'), service.resume()]);
    assert.equal(peak, 1, 'the journal has exactly one writer at a time');
  });

  test('a failed batch does not wedge the queue', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'overlook-src-'));
    writeFileSync(join(sourceDir, 'a.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    let calls = 0;
    const engine = {
      importFiles: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error('first batch dies'));
        }
        return Promise.resolve({ imported: 0, duplicates: 0, failed: 0, cancelled: 0, photoIds: [] });
      },
      resume: () => Promise.resolve(null),
    } as unknown as ImportEngine;
    const service = new ImportService(fakeRepo(), IDLE_EVENTS, engine);
    await assert.rejects(service.run(sourceDir, 'copy'));
    await service.run(sourceDir, 'copy'); // must not hang or reject
    assert.equal(calls, 2);
  });
});
