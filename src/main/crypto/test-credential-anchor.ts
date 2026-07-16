import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CredentialAnchor, CredentialAnchorStore } from './app-lock-credentials.js';

/** Explicit unpackaged-test seam. Production never selects this adapter;
 * it exists so E2E can persist restart state without modifying a developer's
 * Keychain or depending on CI desktop credential services. */
export class TestFileCredentialAnchorStore implements CredentialAnchorStore {
  constructor(private readonly path: string) {}

  isAvailable(): boolean {
    return true;
  }

  read(): CredentialAnchor | null {
    if (!existsSync(this.path)) return null;
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as CredentialAnchor;
      return typeof value.libraryId === 'string' && Number.isSafeInteger(value.generation) && /^[0-9a-f]{64}$/u.test(value.recordHash)
        ? value
        : null;
    } catch {
      return null;
    }
  }

  write(anchor: CredentialAnchor): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(anchor), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }
}
