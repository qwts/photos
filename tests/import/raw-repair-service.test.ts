import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RawRepairService } from '../../src/main/import/raw-repair-service.js';
import type { ExtractedMetadata } from '../../src/main/import/exif.js';
import type { PhotoRecord } from '../../src/shared/library/types.js';

const EMPTY: ExtractedMetadata = {
  width: null,
  height: null,
  camera: null,
  lens: null,
  iso: null,
  aperture: null,
  shutter: null,
  focalLength: null,
  takenAt: null,
  gpsLat: null,
  gpsLon: null,
};

function raw(overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id: 'RAW1',
    fileName: 'legacy.nef',
    fileKind: 'raw',
    width: 0,
    height: 0,
    bytes: 512,
    contentHash: 'a'.repeat(64),
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
    importedAt: '2026-07-01T00:00:00.000Z',
    importSource: 'card',
    favorite: false,
    keyId: 1,
    deletedAt: null,
    syncState: 'local',
    ...overrides,
  };
}

describe('RAW repair service (#368)', () => {
  test('repairs metadata and encrypted derivatives in place, then zeroizes plaintext', async () => {
    const bytes = Buffer.from('decrypted raw original');
    let repairedMetadata: ExtractedMetadata | undefined;
    const changed: string[][] = [];
    const service = new RawRepairService({
      candidates: () => [raw()],
      validThumbs: () => Promise.resolve(false),
      loadOriginal: () => Promise.resolve(bytes),
      extractMetadata: () => Promise.resolve({ ...EMPTY, camera: 'Nikon Z8' }),
      regenerate: () => Promise.resolve({ generated: true, width: 8256, height: 5504 }),
      repairMetadata: (_id, metadata) => {
        repairedMetadata = metadata;
        return true;
      },
      changed: (ids) => changed.push([...ids]),
      yieldTurn: () => Promise.resolve(),
    });

    assert.deepEqual(await service.repair(), { scanned: 1, repaired: 1, failed: 0, skipped: 0 });
    assert.deepEqual({ width: repairedMetadata?.width, height: repairedMetadata?.height }, { width: 8256, height: 5504 });
    assert.equal(repairedMetadata?.camera, 'Nikon Z8');
    assert.deepEqual(changed, [['RAW1']]);
    assert.deepEqual(bytes, Buffer.alloc(bytes.length));
  });

  test('complete records with authenticated derivatives do not decrypt originals', async () => {
    let loads = 0;
    const service = new RawRepairService({
      candidates: () => [raw({ width: 700, height: 525 })],
      validThumbs: () => Promise.resolve(true),
      loadOriginal: () => {
        loads += 1;
        return Promise.resolve(Buffer.alloc(1));
      },
      extractMetadata: () => Promise.resolve(EMPTY),
      regenerate: () => Promise.resolve({ generated: false, width: null, height: null }),
      repairMetadata: () => false,
      changed: () => undefined,
    });
    assert.deepEqual(await service.repair(), { scanned: 1, repaired: 0, failed: 0, skipped: 1 });
    assert.equal(loads, 0);
  });

  test('unsupported/corrupt RAW records failure without deleting the original', async () => {
    const bytes = Buffer.from('retained original');
    const service = new RawRepairService({
      candidates: () => [raw()],
      validThumbs: () => Promise.resolve(false),
      loadOriginal: () => Promise.resolve(bytes),
      extractMetadata: () => Promise.resolve(EMPTY),
      regenerate: () => Promise.resolve({ generated: false, width: null, height: null }),
      repairMetadata: () => false,
      changed: () => undefined,
      yieldTurn: () => Promise.resolve(),
    });
    assert.deepEqual(await service.repair(), { scanned: 1, repaired: 0, failed: 1, skipped: 0 });
    assert.deepEqual(bytes, Buffer.alloc(bytes.length), 'only the in-memory plaintext is wiped');
  });

  test('close cancels an unstarted batch', async () => {
    const service = new RawRepairService({
      candidates: () => [raw(), raw({ id: 'RAW2' })],
      validThumbs: () => Promise.resolve(false),
      loadOriginal: () => Promise.resolve(Buffer.alloc(1)),
      extractMetadata: () => Promise.resolve(EMPTY),
      regenerate: () => Promise.resolve({ generated: false, width: null, height: null }),
      repairMetadata: () => false,
      changed: () => undefined,
    });
    service.close();
    assert.deepEqual(await service.repair(), { scanned: 0, repaired: 0, failed: 0, skipped: 0 });
  });
});
