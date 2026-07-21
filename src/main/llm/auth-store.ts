import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LlmProviderId } from '../../shared/llm/provider.js';
import type { SafeStorageLike } from '../crypto/keystore.js';

// LLM API-key custody (ADR-0018 §7). An API key is credential material, so it
// gets the provider-token treatment (the pCloud token-store pattern, #254):
// sealed by the OS keychain via safeStorage, written atomically, never logged,
// under a per-profile dir — `userData/llm-auth/<providerId>/` — that lives
// outside the library and outside every backup surface by construction. The
// key never touches settings.json. A record that fails to decrypt or parse
// reads as "not connected" rather than crashing: the user re-enters the key,
// which rewrites it.

const AUTH_FILE = 'key.bin';

export class LlmCustodyError extends Error {
  override readonly name = 'LlmCustodyError';
}

interface LlmKeyRecord {
  readonly apiKey: string;
  readonly connectedAt: string;
}

function isKeyRecord(value: unknown): value is LlmKeyRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['apiKey'] === 'string' && record['apiKey'] !== '' && typeof record['connectedAt'] === 'string';
}

export interface LlmAuthStoreOptions {
  readonly safeStorage: SafeStorageLike;
  /** Root LLM-auth directory; per-provider subdirectories hang off it. */
  readonly authRootDir: string;
}

/** Sealed per-provider API-key custody under `<authRootDir>/<providerId>/key.bin`. */
export class LlmAuthStore {
  private readonly safeStorage: SafeStorageLike;
  private readonly authRootDir: string;

  constructor(options: LlmAuthStoreOptions) {
    this.safeStorage = options.safeStorage;
    this.authRootDir = options.authRootDir;
  }

  private dirFor(providerId: LlmProviderId): string {
    return join(this.authRootDir, providerId);
  }

  private fileFor(providerId: LlmProviderId): string {
    return join(this.dirFor(providerId), AUTH_FILE);
  }

  save(providerId: LlmProviderId, apiKey: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new LlmCustodyError('OS keychain encryption is unavailable; cannot store the API key.');
    }
    const record: LlmKeyRecord = { apiKey, connectedAt: new Date().toISOString() };
    const dir = this.dirFor(providerId);
    mkdirSync(dir, { recursive: true });
    const sealed = this.safeStorage.encryptString(JSON.stringify(record));
    const filePath = this.fileFor(providerId);
    const staged = `${filePath}.tmp`;
    writeFileSync(staged, sealed);
    renameSync(staged, filePath);
  }

  /** The stored key, or null when none is in custody (or the record is unreadable). */
  load(providerId: LlmProviderId): string | null {
    const filePath = this.fileFor(providerId);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(this.safeStorage.decryptString(readFileSync(filePath)));
      return isKeyRecord(parsed) ? parsed.apiKey : null;
    } catch {
      return null;
    }
  }

  has(providerId: LlmProviderId): boolean {
    return this.load(providerId) !== null;
  }

  clear(providerId: LlmProviderId): void {
    rmSync(this.fileFor(providerId), { force: true });
  }
}
