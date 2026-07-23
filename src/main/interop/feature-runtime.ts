import type { PCloudFeatureConfig } from '../build-config.js';
import type { SafeStorageLike } from '../crypto/keystore.js';
import type { ImportRuntime } from '../import/import-runtime.js';
import type { LibraryParts } from '../library/library-parts.js';
import { configureProductionInboundMove } from './inbound-move-production.js';
import { configureInteropRuntime } from './runtime.js';

export interface PCloudInteropFeatureOptions {
  readonly config: PCloudFeatureConfig;
  readonly profileDirectory: string;
  readonly safeStorage: SafeStorageLike;
  readonly openExternal: (url: string) => Promise<void>;
  readonly pcloudFixtureRoot: string | undefined;
  readonly library: () => LibraryParts;
  readonly imports: () => ImportRuntime | undefined;
  readonly pairingFixture: () => string | undefined;
  readonly imported: () => void;
}

/** Keeps the disabled feature out of runtime composition entirely: no token
 * store, provider transport, controller, or browser OAuth flow exists until
 * the build gate and client ID are both present. */
export function configurePCloudInteropFeature(options: PCloudInteropFeatureOptions): void {
  if (!options.config.enabled || options.config.clientId === null) return;
  configureInteropRuntime(
    options.profileDirectory,
    options.safeStorage,
    options.openExternal,
    options.config.clientId,
    options.pcloudFixtureRoot,
  );
  configureProductionInboundMove(options.library, options.imports, options.pairingFixture, options.imported);
}
