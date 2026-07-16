import type { AppLockController } from './app-lock-controller.js';
import { readRecoveryKeyFile } from './recovery-key-facade.js';
import { openRecoveryKey, RecoveryError } from './recovery.js';
import { readKeysFile, unwrapStoredKey } from './keystore.js';

export type AppLockRecoveryResult =
  | { readonly recovered: true; readonly reason: null }
  | { readonly recovered: false; readonly reason: 'invalid' | 'wrong-password' | 'mismatch' };

export interface RecoverAppLockOptions {
  readonly controller: AppLockController;
  readonly dataDir: string;
  readonly libraryId: string;
  readonly path: string;
  readonly recoveryPassword: string;
  readonly nextPassword: string;
}

export async function recoverAppLock(options: RecoverAppLockOptions): Promise<AppLockRecoveryResult> {
  let masterKey: Buffer | undefined;
  try {
    masterKey = openRecoveryKey(await readRecoveryKeyFile(options.path), options.recoveryPassword);
    const keys = readKeysFile(options.dataDir);
    if (keys === null || keys.keys.length === 0) return { recovered: false, reason: 'mismatch' };
    try {
      for (const record of keys.keys) unwrapStoredKey(masterKey, record.id, record.wrappedKey);
    } catch {
      return { recovered: false, reason: 'mismatch' };
    }
    await options.controller.recover({ libraryId: options.libraryId, password: options.nextPassword, masterKey });
    return { recovered: true, reason: null };
  } catch (error) {
    return { recovered: false, reason: error instanceof RecoveryError ? error.reason : 'invalid' };
  } finally {
    masterKey?.fill(0);
  }
}
