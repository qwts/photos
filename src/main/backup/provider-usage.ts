import type { ProviderDescriptor, ProviderStorageMetrics } from '../../shared/backup/provider-descriptor.js';
import type { ProviderQuota, StorageProvider } from './provider.js';

// Provider storage status (#684). Two independent figures that never blend:
// "Used by Overlook" (the exact byte total of Overlook's OWN remote objects) and
// account-wide capacity (only from a verified quota API). The measurement uses
// only the StorageProvider seam — `listLibraries()` + `forLibrary().list('.')` —
// so it works for every adapter without provider-specific code. Each adapter's
// `list('.')` is recursive (google walk, pcloud recursive:'1', iCloud native
// prefix listing, mock readdir recursive), so one list per library enumerates
// all of that library's objects. Ambiguous/scratch data is included only where
// the adapter's listing already classifies it as Overlook data; conflicted or
// foreign entries throw in the adapter and surface as a measurement failure
// rather than being over-counted.

/** Sums the bytes of every Overlook-owned remote object across all discoverable
 * libraries. Throws if any listing fails — callers treat that as a
 * calculation-failure (the figure is absent, never fabricated). */
export async function measureUsedByOverlookBytes(provider: StorageProvider, signal?: AbortSignal): Promise<number> {
  const libraries = await provider.listLibraries(signal);
  let total = 0;
  for (const libraryId of libraries) {
    signal?.throwIfAborted();
    const entries = await provider.forLibrary(libraryId).list('.', signal);
    for (const entry of entries) {
      total += entry.bytes;
    }
  }
  return total;
}

export interface ProviderStorageMetricsInputs {
  readonly descriptor: ProviderDescriptor;
  readonly connected: boolean;
  /** Measures "Used by Overlook"; a throw becomes measurementFailed. */
  readonly measure: () => Promise<number>;
  /** Account-wide quota, or null when the provider has no trustworthy source. */
  readonly quota: (() => Promise<ProviderQuota>) | null;
  /** Timestamp source for a successful measurement (injectable for tests). */
  readonly now: () => string;
}

/** Assembles the two-figure status. Neither a measurement failure nor a quota
 * failure changes connection authority (invariant I5): each degrades only its
 * own figure. Capacity renders only from a verified quota that reports a finite
 * total; otherwise iCloud routes to System Settings and other providers show a
 * plain "unavailable". */
export async function buildProviderStorageMetrics(inputs: ProviderStorageMetricsInputs): Promise<ProviderStorageMetrics> {
  const { descriptor, connected } = inputs;
  if (!connected) {
    return {
      usedByOverlookBytes: null,
      measuredAt: null,
      measurementFailed: false,
      capacity: null,
      capacityRoute: 'none',
    };
  }

  const [measurementResult, quotaResult] = await Promise.allSettled([
    inputs.measure(),
    inputs.quota === null ? Promise.resolve(null) : inputs.quota(),
  ]);
  const usedByOverlookBytes = measurementResult.status === 'fulfilled' ? measurementResult.value : null;
  const measuredAt = measurementResult.status === 'fulfilled' ? inputs.now() : null;
  const measurementFailed = measurementResult.status === 'rejected';
  const quota = quotaResult.status === 'fulfilled' ? quotaResult.value : null;
  const capacity: ProviderStorageMetrics['capacity'] =
    quota?.totalBytes === null || quota === null ? null : { usedBytes: quota.usedBytes, totalBytes: quota.totalBytes };

  const capacityRoute: ProviderStorageMetrics['capacityRoute'] =
    capacity === null && descriptor.id === 'icloud-drive' ? 'system-settings' : 'none';

  return {
    usedByOverlookBytes,
    measuredAt,
    measurementFailed,
    capacity,
    capacityRoute,
  };
}
