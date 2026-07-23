import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PosterCaptureService, type PosterCaptureServiceOptions } from '../../src/main/import/poster-capture-service.js';
import type { PhotoRecord } from '../../src/shared/library/types.js';

function videoPhoto(id: string): PhotoRecord {
  return {
    id,
    fileName: `${id}.ts`,
    fileKind: 'video',
    width: 0,
    height: 0,
    bytes: 1000,
    contentHash: id.repeat(8).slice(0, 64),
    camera: null,
    lens: null,
    iso: null,
    aperture: null,
    shutter: null,
    focalLength: null,
    takenAt: null,
    gpsLat: null,
    gpsLon: null,
    place: null,
    importedAt: '2026-07-12T00:00:00.000Z',
    importSource: 'seed',
    favorite: false,
    isOriginal: false,
    keyId: 1,
    deletedAt: null,
    previewFailure: null,
    dimensionStatus: 'unavailable',
    mediaInfo: null,
    syncState: 'local',
  };
}

const noYield = { yieldTurn: (): Promise<void> => Promise.resolve() };

function build(overrides: Partial<PosterCaptureServiceOptions>): { service: PosterCaptureService; changed: string[][] } {
  const changed: string[][] = [];
  const service = new PosterCaptureService({
    candidates: () => [videoPhoto('a'), videoPhoto('b')],
    hasPoster: () => Promise.resolve(false),
    captureFrame: () => Promise.resolve(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    storePoster: () => Promise.resolve({ generated: true, width: 512, height: 288 }),
    changed: (ids) => changed.push([...ids]),
    ...noYield,
    ...overrides,
  });
  return { service, changed };
}

describe('PosterCaptureService (ADR-0026 §6)', () => {
  test('captures a poster for each candidate and reports the changed ids', async () => {
    const { service, changed } = build({});
    assert.deepEqual(await service.capture(), { scanned: 2, captured: 2, failed: 0, skipped: 0 });
    assert.deepEqual(changed, [['a', 'b']]);
  });

  test('skips items that already have a poster', async () => {
    const { service, changed } = build({ hasPoster: (photo) => Promise.resolve(photo.id === 'a') });
    assert.deepEqual(await service.capture(), { scanned: 2, captured: 1, failed: 0, skipped: 1 });
    assert.deepEqual(changed, [['b']]);
  });

  test('a frame that never decodes leaves the placeholder — not a failed import', async () => {
    const { service, changed } = build({ captureFrame: () => Promise.resolve(null) });
    assert.deepEqual(await service.capture(), { scanned: 2, captured: 0, failed: 2, skipped: 0 });
    assert.deepEqual(changed, []); // no poster stored, nothing to refresh
  });

  test('a capture fault never surfaces; the item is simply retried later', async () => {
    const { service } = build({
      captureFrame: () => Promise.reject(new Error('offscreen crashed')),
    });
    const summary = await service.capture();
    assert.deepEqual(summary, { scanned: 2, captured: 0, failed: 2, skipped: 0 });
  });

  test('close() cancels the pass between items', async () => {
    let seen = 0;
    const service = new PosterCaptureService({
      candidates: () => [videoPhoto('a'), videoPhoto('b'), videoPhoto('c')],
      hasPoster: () => Promise.resolve(false),
      captureFrame: () => {
        seen += 1;
        service.close();
        return Promise.resolve(null);
      },
      storePoster: () => Promise.resolve({ generated: true, width: 1, height: 1 }),
      changed: () => undefined,
      ...noYield,
    });
    const summary = await service.capture();
    assert.equal(seen, 1);
    assert.equal(summary.scanned, 1);
  });
});
