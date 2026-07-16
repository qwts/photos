import type { SafeStorageLike } from './keystore.js';

export interface CredentialAnchor {
  readonly libraryId: string;
  readonly generation: number;
  readonly recordHash: string;
}

export interface CredentialAnchorStore {
  read(): CredentialAnchor | null;
  write(anchor: CredentialAnchor): void;
  clear(): void;
}

export type AppLockStatus =
  | { readonly state: 'unconfigured' }
  | { readonly state: 'locked'; readonly libraryId: string }
  | { readonly state: 'recovery-required'; readonly reason: 'anchor-mismatch' | 'anchor-missing' | 'invalid-record' };

export type UnlockResult =
  { readonly ok: true; readonly masterKey: Buffer } | { readonly ok: false; readonly reason: 'wrong-password' | 'recovery-required' };

export interface AppLockCredentialStoreOptions {
  readonly dataDir: string;
  readonly anchorStore: CredentialAnchorStore;
  readonly safeStorage: SafeStorageLike;
}

export interface ConfigureAppLockInput {
  readonly libraryId: string;
  readonly password: string;
  readonly masterKey: Buffer;
}

/** ADR-0013 credential-custody scaffold. The contract tests land first; the
 * implementation follows in the next commit on the draft PR. */
export class AppLockCredentialStore {
  constructor(private readonly options: AppLockCredentialStoreOptions) {}

  configure(input: ConfigureAppLockInput): Promise<void> {
    void input;
    return Promise.reject(new Error('app-lock credential storage is not implemented'));
  }

  status(): AppLockStatus {
    throw new Error('app-lock credential storage is not implemented');
  }

  unlock(password: string): Promise<UnlockResult> {
    void password;
    return Promise.reject(new Error('app-lock credential storage is not implemented'));
  }

  changePassword(currentPassword: string, nextPassword: string): Promise<boolean> {
    void currentPassword;
    void nextPassword;
    return Promise.reject(new Error('app-lock credential storage is not implemented'));
  }

  recover(input: ConfigureAppLockInput): Promise<void> {
    void input;
    return Promise.reject(new Error('app-lock credential storage is not implemented'));
  }

  remove(password: string): Promise<boolean> {
    void password;
    return Promise.reject(new Error('app-lock credential storage is not implemented'));
  }

  anchor(): CredentialAnchor | null {
    return this.options.anchorStore.read();
  }
}
