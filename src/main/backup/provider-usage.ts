import type { StorageProvider } from './provider.js';

// "Used by Overlook" measurement (#684): the exact byte total of Overlook's own
// remote objects, summed across every discoverable library under the provider's
// container namespace. This is deliberately separate from account-wide capacity
// (`quota()`): it counts only what Overlook wrote, never "used by everything".
//
// It uses only the StorageProvider seam — `listLibraries()` + `forLibrary().list('.')`
// — so it works uniformly for every adapter without provider-specific code. Each
// adapter's `list('.')` is recursive (google walk, pcloud recursive:'1', iCloud
// native prefix listing, mock readdir recursive), so a single list per library
// enumerates all of that library's objects. Ambiguous/scratch data is included
// only where the adapter's own listing already classifies it as Overlook data;
// conflicted/foreign entries throw in the adapter and surface as a measurement
// failure rather than being over-counted.

/** Sums the bytes of every Overlook-owned remote object across all discoverable
 * libraries. Throws if any listing fails — callers treat that as a
 * calculation-failure (the figure is absent, never fabricated). */
export async function measureUsedByOverlookBytes(provider: StorageProvider): Promise<number> {
  const libraries = await provider.listLibraries();
  let total = 0;
  for (const libraryId of libraries) {
    const entries = await provider.forLibrary(libraryId).list('.');
    for (const entry of entries) {
      total += entry.bytes;
    }
  }
  return total;
}
