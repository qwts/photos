import type { ProtectedAlbumAuthorityRegistry } from './protected-album-authority.js';
import {
  changeProtectedAlbumPassword,
  createProtectedAlbumCustody,
  openProtectedAlbumMetadata,
  ProtectedAlbumCredentialError,
  recoverProtectedAlbumPassword,
  unlockProtectedAlbumCustody,
  type ProtectedAlbumMetadata,
} from './protected-album-credentials.js';
import type { ProtectedAlbumRepository } from '../db/protected-album-repository.js';

export type ProtectedAlbumUnlockResult =
  | { readonly ok: true; readonly metadata: ProtectedAlbumMetadata }
  | { readonly ok: false; readonly reason: 'not-found' | 'wrong-password' | 'invalid-record' };

export type ProtectedAlbumRecoveryResult =
  | { readonly ok: true; readonly metadata: ProtectedAlbumMetadata }
  | { readonly ok: false; readonly reason: 'not-found' | 'wrong-recovery-key' | 'invalid-record' };

export class ProtectedAlbumServiceError extends Error {
  override readonly name = 'ProtectedAlbumServiceError';
}

export interface ProtectedAlbumServiceOptions {
  readonly libraryId: string;
  readonly repository: ProtectedAlbumRepository;
  readonly authorities: ProtectedAlbumAuthorityRegistry;
}

export class ProtectedAlbumService {
  constructor(private readonly options: ProtectedAlbumServiceOptions) {}

  async provision(input: {
    readonly albumId: string;
    readonly password: string;
    readonly masterKey: Buffer;
    readonly metadata: ProtectedAlbumMetadata;
  }): Promise<void> {
    if (this.options.repository.get(input.albumId) !== undefined) throw new ProtectedAlbumServiceError('protected album already exists');
    const custody = await createProtectedAlbumCustody({ libraryId: this.options.libraryId, ...input });
    try {
      this.options.repository.insertStaged({
        albumId: input.albumId,
        credentialRecord: custody.credentialRecord,
        sealedMetadata: custody.sealedMetadata,
      });
      this.options.authorities.authorize(input.albumId, custody.albumKey);
    } finally {
      custody.albumKey.fill(0);
    }
  }

  async unlock(albumId: string, password: string): Promise<ProtectedAlbumUnlockResult> {
    const stored = this.options.repository.get(albumId);
    if (stored === undefined) return { ok: false, reason: 'not-found' };
    try {
      const unlocked = await unlockProtectedAlbumCustody(
        { libraryId: this.options.libraryId, albumId },
        stored.credentialRecord,
        stored.sealedMetadata,
        password,
      );
      try {
        this.options.authorities.authorize(albumId, unlocked.albumKey);
        return { ok: true, metadata: unlocked.metadata };
      } finally {
        unlocked.albumKey.fill(0);
      }
    } catch (error) {
      if (error instanceof ProtectedAlbumCredentialError) {
        return { ok: false, reason: error.reason === 'wrong-password' ? 'wrong-password' : 'invalid-record' };
      }
      throw error;
    }
  }

  async changePassword(albumId: string, currentPassword: string, nextPassword: string): Promise<boolean> {
    const stored = this.options.repository.get(albumId);
    if (stored === undefined) return false;
    try {
      const changed = await changeProtectedAlbumPassword(
        { libraryId: this.options.libraryId, albumId },
        stored.credentialRecord,
        stored.sealedMetadata,
        currentPassword,
        nextPassword,
      );
      try {
        if (
          !this.options.repository.replaceCredentials({
            albumId,
            expectedCredentialRecord: stored.credentialRecord,
            credentialRecord: changed.credentialRecord,
          })
        ) {
          this.options.authorities.relock(albumId);
          throw new ProtectedAlbumServiceError('protected album credentials changed concurrently');
        }
        // Credential changes terminate the current album authorization.
        // The new password must explicitly release custody again.
        this.options.authorities.relock(albumId);
        return true;
      } finally {
        changed.albumKey.fill(0);
      }
    } catch (error) {
      if (error instanceof ProtectedAlbumCredentialError && error.reason === 'wrong-password') return false;
      throw error;
    }
  }

  async recoverPassword(input: {
    readonly albumId: string;
    readonly recoveryFile: Buffer;
    readonly recoveryPassword: string;
    readonly nextPassword: string;
  }): Promise<ProtectedAlbumRecoveryResult> {
    const stored = this.options.repository.get(input.albumId);
    if (stored === undefined) return { ok: false, reason: 'not-found' };
    try {
      const recovered = await recoverProtectedAlbumPassword(
        { libraryId: this.options.libraryId, albumId: input.albumId },
        stored.credentialRecord,
        stored.sealedMetadata,
        input.recoveryFile,
        input.recoveryPassword,
        input.nextPassword,
      );
      try {
        if (
          !this.options.repository.replaceCredentials({
            albumId: input.albumId,
            expectedCredentialRecord: stored.credentialRecord,
            credentialRecord: recovered.credentialRecord,
          })
        ) {
          this.options.authorities.relock(input.albumId);
          throw new ProtectedAlbumServiceError('protected album credentials changed concurrently');
        }
        // Recovery is a credential ceremony, not a session unlock. Revoke
        // any prior authority and require the new password on the next open.
        this.options.authorities.relock(input.albumId);
        return { ok: true, metadata: recovered.metadata };
      } finally {
        recovered.albumKey.fill(0);
      }
    } catch (error) {
      if (error instanceof ProtectedAlbumCredentialError) {
        return { ok: false, reason: error.reason === 'wrong-recovery-key' ? 'wrong-recovery-key' : 'invalid-record' };
      }
      throw error;
    }
  }

  metadata(albumId: string): ProtectedAlbumMetadata {
    const stored = this.options.repository.get(albumId);
    if (stored === undefined) throw new ProtectedAlbumServiceError('protected album does not exist');
    return this.options.authorities.withAuthority(albumId, (albumKey) =>
      openProtectedAlbumMetadata({ libraryId: this.options.libraryId, albumId }, albumKey, stored.credentialRecord, stored.sealedMetadata),
    );
  }

  async discardStaged(albumId: string, password: string): Promise<boolean> {
    const stored = this.options.repository.get(albumId);
    if (stored === undefined || stored.migrationState !== 'staged') return false;
    let albumKey: Buffer | undefined;
    try {
      const unlocked = await unlockProtectedAlbumCustody(
        { libraryId: this.options.libraryId, albumId },
        stored.credentialRecord,
        stored.sealedMetadata,
        password,
      );
      albumKey = unlocked.albumKey;
      this.options.authorities.relock(albumId);
      return this.options.repository.deleteStaged(albumId);
    } catch (error) {
      if (error instanceof ProtectedAlbumCredentialError && error.reason === 'wrong-password') return false;
      throw error;
    } finally {
      albumKey?.fill(0);
    }
  }

  relock(albumId: string): boolean {
    return this.options.authorities.relock(albumId);
  }

  relockAll(): void {
    this.options.authorities.relockAll();
  }

  close(): void {
    this.options.authorities.close();
  }
}
