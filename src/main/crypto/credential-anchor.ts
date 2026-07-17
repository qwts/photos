import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { z } from 'zod';

import {
  OVERLOOK_APP_LOCK_ANCHOR_MIGRATION_SERVICE,
  OVERLOOK_APP_LOCK_ANCHOR_SERVICE,
  OVERLOOK_LEGACY_APP_LOCK_ANCHOR_SERVICE,
} from '../../shared/app-identity.js';
import type { CredentialAnchor, CredentialAnchorStore } from './app-lock-credentials.js';

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OverlookCredentialAnchor {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, uint type, uint flags);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern void CredFree(IntPtr credential);

  public static void Write(string target, string value) {
    byte[] bytes = System.Text.Encoding.Unicode.GetBytes(value);
    IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, blob, bytes.Length);
      CREDENTIAL credential = new CREDENTIAL {
        Type = 1,
        TargetName = target,
        CredentialBlobSize = (uint)bytes.Length,
        CredentialBlob = blob,
        Persist = 2,
        UserName = "Overlook"
      };
      if (!CredWrite(ref credential, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(blob);
      Array.Clear(bytes, 0, bytes.Length);
    }
  }

  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return null;
      throw new System.ComponentModel.Win32Exception(error);
    }
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      byte[] bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      try { return System.Text.Encoding.Unicode.GetString(bytes); }
      finally { Array.Clear(bytes, 0, bytes.Length); }
    } finally {
      CredFree(pointer);
    }
  }

  public static void Delete(string target) {
    if (!CredDelete(target, 1, 0) && Marshal.GetLastWin32Error() != 1168) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
  }
}
'@

$operation = $env:OVERLOOK_ANCHOR_OPERATION
$target = $env:OVERLOOK_ANCHOR_TARGET
if ($operation -eq 'read') {
  $value = [OverlookCredentialAnchor]::Read($target)
  if ($null -eq $value) {
    [Console]::Out.Write('__OVERLOOK_CREDENTIAL_NOT_FOUND__')
  } else {
    [Console]::Out.Write($value)
  }
} elseif ($operation -eq 'write') {
  [OverlookCredentialAnchor]::Write($target, $env:OVERLOOK_ANCHOR_VALUE)
} elseif ($operation -eq 'clear') {
  [OverlookCredentialAnchor]::Delete($target)
} else {
  throw 'Unknown credential-anchor operation'
}
`;

const WINDOWS_NOT_FOUND = '__OVERLOOK_CREDENTIAL_NOT_FOUND__';
const MIGRATION_MARKER = JSON.stringify({ version: 1, legacyService: OVERLOOK_LEGACY_APP_LOCK_ANCHOR_SERVICE });

type StoredValue = { readonly state: 'found'; readonly value: string } | { readonly state: 'missing' } | { readonly state: 'error' };

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
  readonly spawn?: typeof spawnSync;
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
  private readonly run: typeof spawnSync;

  constructor(options: OsCredentialAnchorStoreOptions) {
    this.account = createHash('sha256').update(options.dataDir).digest('hex');
    this.platform = options.platform ?? process.platform;
    this.run = options.spawn ?? spawnSync;
  }

  isAvailable(): boolean {
    if (this.platform === 'darwin') return existsSync('/usr/bin/security');
    if (this.platform === 'linux') {
      const result = this.run('secret-tool', ['--help'], { encoding: 'utf8', stdio: 'ignore' });
      return result.error === undefined;
    }
    if (this.platform === 'win32') {
      const result = this.run(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
        {
          encoding: 'utf8',
          stdio: 'ignore',
        },
      );
      return result.status === 0;
    }
    return false;
  }

  read(): CredentialAnchor | null {
    const current = this.readService(OVERLOOK_APP_LOCK_ANCHOR_SERVICE);
    if (current.found) {
      if (current.anchor === null || !this.ensureMigrationMarker()) return null;
      return current.anchor;
    }
    if (this.migrationMarkerState() !== 'missing') return null;
    const legacy = this.readService(OVERLOOK_LEGACY_APP_LOCK_ANCHOR_SERVICE);
    if (!legacy.found || legacy.anchor === null) return null;
    try {
      this.write(legacy.anchor);
    } catch {
      // The legacy record remains recoverable, but it is not authoritative
      // until the bounded canonical migration commits in full.
      return null;
    }
    return legacy.anchor;
  }

  private readService(service: string): { readonly found: boolean; readonly anchor: CredentialAnchor | null } {
    const result = this.readStoredValue(service);
    if (result.state === 'missing') return { found: false, anchor: null };
    if (result.state === 'error') return { found: true, anchor: null };
    return { found: true, anchor: parseAnchor(result.value) };
  }

  private readStoredValue(service: string): StoredValue {
    if (this.platform === 'darwin') {
      const result = this.run('/usr/bin/security', ['find-generic-password', '-a', this.account, '-s', service, '-w'], {
        encoding: 'utf8',
      });
      if (result.status === 0) return { state: 'found', value: result.stdout.trim() };
      return result.status === 44 ? { state: 'missing' } : { state: 'error' };
    }
    if (this.platform === 'linux') {
      const result = this.run('secret-tool', ['lookup', 'service', service, 'account', this.account], { encoding: 'utf8' });
      if (result.status === 0) return { state: 'found', value: result.stdout.trim() };
      return result.status === 1 && result.error === undefined && result.stderr.trim() === '' ? { state: 'missing' } : { state: 'error' };
    }
    if (this.platform === 'win32') {
      const result = this.windows('read', service);
      if (result.status !== 0) return { state: 'error' };
      const value = result.stdout.trim();
      return value === WINDOWS_NOT_FOUND ? { state: 'missing' } : { state: 'found', value };
    }
    return { state: 'error' };
  }

  private migrationMarkerState(): 'present' | 'missing' | 'error' {
    const result = this.readStoredValue(OVERLOOK_APP_LOCK_ANCHOR_MIGRATION_SERVICE);
    if (result.state !== 'found') return result.state;
    return result.value === MIGRATION_MARKER ? 'present' : 'error';
  }

  private ensureMigrationMarker(): boolean {
    const state = this.migrationMarkerState();
    if (state === 'present') return true;
    if (state === 'error') return false;
    try {
      this.writeStoredValue(OVERLOOK_APP_LOCK_ANCHOR_MIGRATION_SERVICE, MIGRATION_MARKER, 'Overlook app-lock anchor migration');
      return true;
    } catch {
      return false;
    }
  }

  write(anchor: CredentialAnchor): void {
    const value = JSON.stringify(anchorSchema.parse(anchor));
    this.writeStoredValue(OVERLOOK_APP_LOCK_ANCHOR_SERVICE, value, 'Overlook app-lock anchor');
    this.writeStoredValue(OVERLOOK_APP_LOCK_ANCHOR_MIGRATION_SERVICE, MIGRATION_MARKER, 'Overlook app-lock anchor migration');
  }

  private writeStoredValue(service: string, value: string, label: string): void {
    const result =
      this.platform === 'darwin'
        ? this.run('/usr/bin/security', ['add-generic-password', '-U', '-a', this.account, '-s', service, '-w', value], {
            encoding: 'utf8',
          })
        : this.platform === 'linux'
          ? this.run('secret-tool', ['store', `--label=${label}`, 'service', service, 'account', this.account], {
              encoding: 'utf8',
              input: value,
            })
          : this.platform === 'win32'
            ? this.windows('write', service, value)
            : { status: 1 };
    if (result.status !== 0) throw new Error('OS credential store refused the app-lock anchor');
  }

  clear(): void {
    for (const service of [
      OVERLOOK_APP_LOCK_ANCHOR_SERVICE,
      OVERLOOK_APP_LOCK_ANCHOR_MIGRATION_SERVICE,
      OVERLOOK_LEGACY_APP_LOCK_ANCHOR_SERVICE,
    ]) {
      if (this.platform === 'darwin') {
        this.run('/usr/bin/security', ['delete-generic-password', '-a', this.account, '-s', service], { stdio: 'ignore' });
      } else if (this.platform === 'linux') {
        this.run('secret-tool', ['clear', 'service', service, 'account', this.account], { stdio: 'ignore' });
      } else if (this.platform === 'win32') {
        this.windows('clear', service);
      }
    }
  }

  private windows(operation: 'read' | 'write' | 'clear', service: string, value = '') {
    return this.run(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          OVERLOOK_ANCHOR_OPERATION: operation,
          OVERLOOK_ANCHOR_TARGET: `${service}:${this.account}`,
          OVERLOOK_ANCHOR_VALUE: value,
        },
      },
    );
  }
}
