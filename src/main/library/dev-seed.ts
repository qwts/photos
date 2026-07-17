import { seedLibrary, seedSynthetic } from './seed.js';

// Dev/E2E seed harness (#72/#74), extracted from the composition root. Both
// seeds are no-ops on a non-empty library — re-runs on the same profile must
// not duplicate content hashes.

type SeedDb = Parameters<typeof seedLibrary>[0];
type SeedBlobs = Parameters<typeof seedLibrary>[1];
type SeedKey = Parameters<typeof seedLibrary>[2];

export interface DevSeedOptions {
  readonly contentAvailable: boolean;
  readonly harnessEnv: (name: string) => string | undefined;
  /** Triggers the lazy library bootstrap and exposes the open parts. */
  readonly open: () => { db: SeedDb; blobStore: SeedBlobs; currentKey: () => SeedKey; photos: () => number } | undefined;
}

export async function runDevSeeds(options: DevSeedOptions): Promise<void> {
  if (!options.contentAvailable) return;
  const seedCount = Number(options.harnessEnv('OVERLOOK_SEED') ?? '0');
  if (Number.isInteger(seedCount) && seedCount > 0) {
    const parts = options.open();
    if (parts !== undefined) {
      await parts.blobStore.init();
      await seedLibrary(parts.db, parts.blobStore, parts.currentKey(), seedCount);
    }
  }
  // Metadata-only rows sharing one blob — the 200K grid perf baseline (#74).
  const syntheticCount = Number(options.harnessEnv('OVERLOOK_SEED_SYNTHETIC') ?? '0');
  if (Number.isInteger(syntheticCount) && syntheticCount > 0) {
    const parts = options.open();
    if (parts !== undefined && parts.photos() === 0) {
      seedSynthetic(parts.db, parts.currentKey().id, 'synthetic', syntheticCount);
    }
  }
}
