import path from 'node:path';

import { createBackupAuditLogger } from './backup-audit.js';
import { createManifestDebtStore } from './manifest-debt.js';
import { guardProviderSwitch } from './provider-switch-guard.js';
import type { ProviderRuntimeOptions } from './provider-runtime.js';
import { SyncLedger } from './sync-ledger.js';
import { remoteClaims } from '../db/backup-claims.js';
import type { LibraryParts } from '../library/library-parts.js';

// Composition seam for the #741 provider-switch guard, kept out of index.ts
// (file-size budget). The guard resolves the open library's parts lazily so
// runtime construction never bootstraps a library.

export interface ProviderSwitchBindingDeps {
  readonly parts: () => LibraryParts;
  readonly libraryDataDir: () => string;
}

export function createProviderSwitchGuard(deps: ProviderSwitchBindingDeps): NonNullable<ProviderRuntimeOptions['switchGuard']> {
  return async (target) => {
    const parts = deps.parts();
    const ledger = new SyncLedger(parts.db);
    const protectedGuard = parts.protected.switchGuardBinding();
    const audit = createBackupAuditLogger(path.join(deps.libraryDataDir(), 'backup-audit.log'));
    return guardProviderSwitch({
      target,
      ordinaryClaims: () => remoteClaims(parts.db),
      protectedClaims: protectedGuard.claims,
      hasLocalOriginal: (hash) => parts.blobStore.hasOriginal(hash),
      hasLocalProtected: protectedGuard.hasLocal,
      ledger: {
        isDirty: (photoId) => ledger.isDirty(photoId),
        markDirty: (photoId) => ledger.markDirty(photoId),
        repairStatus: (photoId, to) => ledger.repairStatus(photoId, to),
      },
      requeueProtected: protectedGuard.requeue,
      healProtected: protectedGuard.heal,
      markManifestOwed: () => createManifestDebtStore(parts.db).save(true),
      audit,
    });
  };
}
