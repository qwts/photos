import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SafeStorageLike } from '../../crypto/keystore.js';

const AUTHORITY_FILE = 'icloud-drive-authority.bin';
const ACCOUNT_TOKEN = /^[a-f0-9]{16,128}$/u;

export class ICloudDriveAuthorityStore {
  private readonly filePath: string;

  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly dataDir: string,
  ) {
    this.filePath = join(dataDir, AUTHORITY_FILE);
  }

  load(): string | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const token = this.safeStorage.decryptString(readFileSync(this.filePath));
      return ACCOUNT_TOKEN.test(token) ? token : null;
    } catch {
      return null;
    }
  }

  save(accountToken: string): void {
    if (!ACCOUNT_TOKEN.test(accountToken)) throw new Error('invalid iCloud account authority');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS keychain encryption is unavailable');
    mkdirSync(this.dataDir, { recursive: true });
    const staged = `${this.filePath}.tmp`;
    writeFileSync(staged, this.safeStorage.encryptString(accountToken), { mode: 0o600 });
    renameSync(staged, this.filePath);
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
  }
}
