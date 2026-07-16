import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { z } from 'zod';

import type { CredentialAnchor, CredentialAnchorStore } from './app-lock-credentials.js';

const SERVICE = 'com.qwts.overlook.app-lock-anchor';

const anchorSchema = z
  .object({
    libraryId: z.string().min(1).max(256),
    generation: z.number().int().positive(),
    recordHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export interface OsCredentialAnchorStoreOptions {
  readonly dataDir: string;
  readonly platform?: NodeJS.Platform;
}

function parseAnchor(value: string): CredentialAnchor | null {
  try {
    const parsed = anchorSchema.parse(JSON.parse(value) as unknown);
    return JSON.stringify(parsed) === value ? parsed : null;
  } catch {
    return null;
  }
}

/** OS credential-store freshness anchor from ADR-0013. The value is not a
 * secret, but keeping it outside the library prevents rolling it back with a
 * copied library/backup directory. Unsupported or unavailable stores fail
 * closed; they never fall back to a sibling file. */
export class OsCredentialAnchorStore implements CredentialAnchorStore {
  private readonly account: string;
  private readonly platform: NodeJS.Platform;

  constructor(options: OsCredentialAnchorStoreOptions) {
    this.account = createHash('sha256').update(options.dataDir).digest('hex');
    this.platform = options.platform ?? process.platform;
  }

  isAvailable(): boolean {
    if (this.platform === 'darwin') return existsSync('/usr/bin/security');
    if (this.platform === 'linux') {
      const result = spawnSync('secret-tool', ['--help'], { encoding: 'utf8', stdio: 'ignore' });
      return result.error === undefined;
    }
    return false;
  }

  read(): CredentialAnchor | null {
    if (this.platform === 'darwin') {
      const result = spawnSync('/usr/bin/security', ['find-generic-password', '-a', this.account, '-s', SERVICE, '-w'], {
        encoding: 'utf8',
      });
      return result.status === 0 ? parseAnchor(result.stdout.trim()) : null;
    }
    if (this.platform === 'linux') {
      const result = spawnSync('secret-tool', ['lookup', 'service', SERVICE, 'account', this.account], { encoding: 'utf8' });
      return result.status === 0 ? parseAnchor(result.stdout.trim()) : null;
    }
    return null;
  }

  write(anchor: CredentialAnchor): void {
    const value = JSON.stringify(anchorSchema.parse(anchor));
    const result =
      this.platform === 'darwin'
        ? spawnSync('/usr/bin/security', ['add-generic-password', '-U', '-a', this.account, '-s', SERVICE, '-w', value], {
            encoding: 'utf8',
          })
        : spawnSync('secret-tool', ['store', '--label=Overlook app-lock anchor', 'service', SERVICE, 'account', this.account], {
            encoding: 'utf8',
            input: value,
          });
    if (result.status !== 0) throw new Error('OS credential store refused the app-lock anchor');
  }

  clear(): void {
    if (this.platform === 'darwin') {
      spawnSync('/usr/bin/security', ['delete-generic-password', '-a', this.account, '-s', SERVICE], { stdio: 'ignore' });
    } else if (this.platform === 'linux') {
      spawnSync('secret-tool', ['clear', 'service', SERVICE, 'account', this.account], { stdio: 'ignore' });
    }
  }
}
