import { discoverRestore } from './restore-discovery.js';
import { RestoreError } from './restore-types.js';
import type { StorageProvider } from './provider.js';

interface RecoveryGenerationHealthDeps {
  readonly provider: StorageProvider;
  readonly libraryId: string;
  readonly masterKeyBytes: () => Buffer;
}

export function createRecoveryHealthCheck(
  provider: StorageProvider,
  libraryId: () => string,
  keyStore: { readonly masterKeyBytes: () => Buffer },
): () => Promise<boolean> {
  return () => recoveryGenerationHealthy({ provider, libraryId: libraryId(), masterKeyBytes: () => keyStore.masterKeyBytes() });
}

/** Proves the newest advertised recovery generation is decryptable and
 * restorable. A valid older fallback is not enough: the damaged newest
 * generation is replaced so future restores do not depend on fallback. */
export async function recoveryGenerationHealthy(deps: RecoveryGenerationHealthDeps): Promise<boolean> {
  const masterKey = deps.masterKeyBytes();
  try {
    const discovery = await discoverRestore(deps.provider, masterKey);
    return discovery.bootstrap.libraryId === deps.libraryId && discovery.candidates[0]?.generation === discovery.newestGeneration;
  } catch (error) {
    if (error instanceof RestoreError && (error.reason === 'corrupt' || error.reason === 'wrong-key' || error.reason === 'unsupported')) {
      return false;
    }
    throw error;
  } finally {
    masterKey.fill(0);
  }
}
