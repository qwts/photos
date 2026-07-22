import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildProviderStorageStatus, measureUsedByOverlookBytes } from '../../src/main/backup/provider-usage.js';
import type { ProviderDescriptor } from '../../src/shared/backup/provider-descriptor.js';
import type { ProviderQuota, RemoteEntry, StorageProvider } from '../../src/main/backup/provider.js';

// #684: the "Used by Overlook" measurement and the two-figure status assembly.
// Both are pure and exercised here without the full provider runtime.

const NOW = '2026-07-22T00:00:00.000Z';

function descriptor(id: string, quota: 'known' | 'unknown'): ProviderDescriptor {
  return {
    id,
    label: id,
    available: true,
    unavailableReason: null,
    capabilities: {
      quota,
      verification: 'download-hash',
      resumableUpload: false,
      platforms: ['darwin'],
      interactiveAuth: false,
      reconnectRequired: false,
    },
  };
}

/** A provider whose libraries each list a fixed set of entries. Only the members
 * the measurement touches are implemented; everything else throws if reached. */
function providerWithLibraries(libraries: Record<string, readonly RemoteEntry[]>): StorageProvider {
  const scoped = (entries: readonly RemoteEntry[]): StorageProvider =>
    ({
      list: (prefix: string) => {
        assert.equal(prefix, '.', 'usage lists the library root');
        return Promise.resolve(entries);
      },
    }) as unknown as StorageProvider;
  return {
    listLibraries: () => Promise.resolve(Object.keys(libraries)),
    forLibrary: (libraryId: string) => scoped(libraries[libraryId] ?? []),
  } as unknown as StorageProvider;
}

describe('measureUsedByOverlookBytes (#684)', () => {
  test('sums every object across all discoverable libraries', async () => {
    const provider = providerWithLibraries({
      libA: [
        { path: 'a/1', bytes: 100 },
        { path: 'a/2', bytes: 250 },
      ],
      libB: [{ path: 'b/1', bytes: 700 }],
    });
    assert.equal(await measureUsedByOverlookBytes(provider), 1050);
  });

  test('no discoverable libraries measures as zero, not absent', async () => {
    assert.equal(await measureUsedByOverlookBytes(providerWithLibraries({})), 0);
  });

  test('a listing failure propagates (surfaced upstream as a calculation-failure)', async () => {
    const provider = {
      listLibraries: () => Promise.resolve(['libA']),
      forLibrary: () => ({ list: () => Promise.reject(new Error('network')) }) as unknown as StorageProvider,
    } as unknown as StorageProvider;
    await assert.rejects(measureUsedByOverlookBytes(provider), /network/u);
  });
});

describe('buildProviderStorageStatus (#684)', () => {
  const measures = (bytes: number) => () => Promise.resolve(bytes);
  const quotaOf = (usedBytes: number, totalBytes: number | null) => (): Promise<ProviderQuota> =>
    Promise.resolve({ usedBytes, totalBytes });

  test('disconnected: both figures absent, no route, no failure flag', async () => {
    const status = await buildProviderStorageStatus({
      descriptor: descriptor('pcloud', 'known'),
      connected: false,
      measure: measures(999),
      quota: quotaOf(1, 2),
      now: () => NOW,
    });
    assert.deepEqual(status, {
      provider: descriptor('pcloud', 'known'),
      connected: false,
      account: null,
      usedByOverlookBytes: null,
      measuredAt: null,
      measurementFailed: false,
      capacity: null,
      capacityRoute: 'none',
    });
  });

  test('known-quota provider: used figure + verified capacity + timestamp', async () => {
    const status = await buildProviderStorageStatus({
      descriptor: descriptor('google-drive', 'known'),
      connected: true,
      measure: measures(12_400_000_000),
      quota: quotaOf(42_000_000_000, 100_000_000_000),
      now: () => NOW,
    });
    assert.equal(status.connected, true);
    assert.equal(status.usedByOverlookBytes, 12_400_000_000);
    assert.equal(status.measuredAt, NOW);
    assert.equal(status.measurementFailed, false);
    assert.deepEqual(status.capacity, { usedBytes: 42_000_000_000, totalBytes: 100_000_000_000 });
    assert.equal(status.capacityRoute, 'none');
  });

  test('measurement failure keeps the account connected and offers no fabricated figure', async () => {
    const status = await buildProviderStorageStatus({
      descriptor: descriptor('google-drive', 'known'),
      connected: true,
      measure: () => Promise.reject(new Error('list failed')),
      quota: quotaOf(42, 100),
      now: () => NOW,
    });
    assert.equal(status.connected, true, 'connection authority is unchanged by a measurement failure (I5)');
    assert.equal(status.usedByOverlookBytes, null);
    assert.equal(status.measuredAt, null);
    assert.equal(status.measurementFailed, true);
    assert.deepEqual(status.capacity, { usedBytes: 42, totalBytes: 100 }, 'capacity is independent of the used measurement');
  });

  test('quota failure leaves the account connected with no capacity and no route (known provider)', async () => {
    const status = await buildProviderStorageStatus({
      descriptor: descriptor('pcloud', 'known'),
      connected: true,
      measure: measures(500),
      quota: () => Promise.reject(new Error('quota 403')),
      now: () => NOW,
    });
    assert.equal(status.connected, true);
    assert.equal(status.usedByOverlookBytes, 500);
    assert.equal(status.capacity, null);
    assert.equal(status.capacityRoute, 'none', 'a non-iCloud provider does not offer the System Settings route');
  });

  test('a quota without a finite total yields no capacity bar', async () => {
    const status = await buildProviderStorageStatus({
      descriptor: descriptor('pcloud', 'known'),
      connected: true,
      measure: measures(500),
      quota: quotaOf(500, null),
      now: () => NOW,
    });
    assert.equal(status.capacity, null);
    assert.equal(status.capacityRoute, 'none');
  });

  test('iCloud (unknown quota): used figure + System Settings route, never a total', async () => {
    const status = await buildProviderStorageStatus({
      descriptor: descriptor('icloud-drive', 'unknown'),
      connected: true,
      measure: measures(51_742_097_408),
      quota: null,
      now: () => NOW,
    });
    assert.equal(status.usedByOverlookBytes, 51_742_097_408);
    assert.equal(status.capacity, null);
    assert.equal(status.capacityRoute, 'system-settings');
  });

  test('zero used is a real, reported figure', async () => {
    const status = await buildProviderStorageStatus({
      descriptor: descriptor('icloud-drive', 'unknown'),
      connected: true,
      measure: measures(0),
      quota: null,
      now: () => NOW,
    });
    assert.equal(status.usedByOverlookBytes, 0);
    assert.equal(status.measurementFailed, false);
    assert.equal(status.capacityRoute, 'system-settings');
  });
});
