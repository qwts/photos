import type { StorageProvider } from './provider.js';
import { protectedObjectPath } from './protected-object-path.js';
import type { ProtectedRemoteObject } from '../db/protected-recovery-repository.js';

// Provider-switch guard (#741). Selecting a provider re-routes every backup
// operation instantly (active-provider facade), but the library's
// synced/offloaded claims were verified against the PREVIOUS provider. This
// guard proves, from the target provider's own listing, that every
// remote-only object the library promises already exists there — otherwise
// the switch fails closed with a reason the existing connection result can
// surface. Locally available originals are re-queued for the target instead.
// ADR-0028 (#729–#733) will replace this listing-based proof with bound
// custody authorities; until then the ground truth is the listing itself.

export interface OrdinarySwitchClaim {
  readonly id: string;
  readonly contentHash: string;
  readonly status: 'synced' | 'offloaded' | 'error';
}

export interface ProviderSwitchGuardDeps {
  readonly target: { readonly providerId: string; readonly provider: StorageProvider };
  readonly ordinaryClaims: () => readonly OrdinarySwitchClaim[];
  readonly protectedClaims: () => readonly ProtectedRemoteObject[];
  readonly hasLocalOriginal: (contentHash: string) => boolean;
  readonly hasLocalProtected: (albumId: string, blobRef: string, kind: ProtectedRemoteObject['kind']) => boolean;
  readonly ledger: {
    readonly isDirty: (photoId: string) => boolean;
    readonly markDirty: (photoId: string) => void;
    readonly repairStatus: (photoId: string, to: 'offloaded' | 'error') => void;
  };
  readonly requeueProtected: (object: ProtectedRemoteObject) => void;
  readonly healProtected: (object: ProtectedRemoteObject) => void;
  /** The switch owes the target a fresh manifest generation. */
  readonly markManifestOwed: () => void;
  readonly audit: (line: string) => void;
}

export interface ProviderSwitchVerdict {
  readonly ok: boolean;
  readonly reason: string | null;
}

function blobPath(contentHash: string): string {
  return `blobs/${contentHash.slice(0, 2)}/${contentHash}`;
}

/**
 * Fail-closed activation check. Called before `settings.providerId` changes:
 *
 * - remote-only claims (no local original) must ALL be present on the target
 *   provider's listing, or the switch is refused with a useful reason —
 *   including claims a wrong provider's earlier integrity pass flipped to
 *   'error', which heal back to clean offloaded rows when the target proves
 *   it holds them (the un-trap path, #741 requirement 6);
 * - locally available originals the target is missing re-queue as dirty so
 *   the next backup uploads them to the target;
 * - a switch always owes the target a fresh manifest generation.
 */
export async function guardProviderSwitch(deps: ProviderSwitchGuardDeps): Promise<ProviderSwitchVerdict> {
  const ordinary = deps.ordinaryClaims();
  const protectedObjects = deps.protectedClaims();
  if (ordinary.length === 0 && protectedObjects.length === 0) {
    return { ok: true, reason: null };
  }
  let remoteBlobs: ReadonlySet<string>;
  let remoteProtected: ReadonlySet<string>;
  try {
    remoteBlobs = new Set((await deps.target.provider.list('blobs')).map((entry) => entry.path));
    remoteProtected =
      protectedObjects.length === 0
        ? new Set<string>()
        : new Set((await deps.target.provider.list('protected')).map((entry) => entry.path));
  } catch {
    return {
      ok: false,
      reason: 'Could not verify this provider holds the library’s cloud-only originals. Check the connection and try again.',
    };
  }

  let missingRemoteOnly = 0;
  const requeueOrdinary: OrdinarySwitchClaim[] = [];
  const healOrdinary: OrdinarySwitchClaim[] = [];
  for (const claim of ordinary) {
    const path = blobPath(claim.contentHash);
    const local = deps.hasLocalOriginal(claim.contentHash);
    if (local) {
      // 'error' rows with a local original are the ordinary retry path's
      // work (dirty upload), not the guard's.
      if (claim.status === 'synced' && !remoteBlobs.has(path)) requeueOrdinary.push(claim);
      continue;
    }
    if (!remoteBlobs.has(path)) {
      missingRemoteOnly += 1;
    } else if (claim.status === 'error') {
      healOrdinary.push(claim);
    }
  }

  const requeueProtected: ProtectedRemoteObject[] = [];
  const healProtected: ProtectedRemoteObject[] = [];
  for (const object of protectedObjects) {
    const path = protectedObjectPath(object.blobRef, object.kind);
    const local = deps.hasLocalProtected(object.albumId, object.blobRef, object.kind);
    if (local) {
      if (object.status === 'synced' && !remoteProtected.has(path)) requeueProtected.push(object);
      continue;
    }
    if (!remoteProtected.has(path)) {
      // A verified ciphertext identity is required to ever re-prove the
      // object; without one the claim cannot be satisfied anywhere.
      missingRemoteOnly += 1;
    } else if (object.status === 'error' && object.sha256 !== null) {
      healProtected.push(object);
    }
  }

  if (missingRemoteOnly > 0) {
    deps.audit(`PROVIDER-SWITCH-BLOCKED provider=${deps.target.providerId} remoteOnlyMissing=${String(missingRemoteOnly)}`);
    return {
      ok: false,
      reason:
        `${String(missingRemoteOnly)} cloud-only ${missingRemoteOnly === 1 ? 'original is' : 'originals are'} not in this provider. ` +
        'Restore them to this device first, or switch back to the provider that holds them.',
    };
  }

  for (const claim of requeueOrdinary) {
    if (!deps.ledger.isDirty(claim.id)) deps.ledger.markDirty(claim.id);
  }
  for (const object of requeueProtected) {
    deps.requeueProtected(object);
  }
  for (const claim of healOrdinary) {
    deps.ledger.repairStatus(claim.id, 'offloaded');
    deps.audit(`PROVIDER-SWITCH-HEALED photo=${claim.id} provider=${deps.target.providerId}`);
  }
  for (const object of healProtected) {
    deps.healProtected(object);
    deps.audit(`PROVIDER-SWITCH-HEALED-PROTECTED provider=${deps.target.providerId}`);
  }
  deps.markManifestOwed();
  deps.audit(
    `PROVIDER-SWITCH-VERIFIED provider=${deps.target.providerId} ` +
      `requeued=${String(requeueOrdinary.length + requeueProtected.length)} healed=${String(healOrdinary.length + healProtected.length)}`,
  );
  return { ok: true, reason: null };
}
