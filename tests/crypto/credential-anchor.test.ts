import assert from 'node:assert/strict';
import type { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, test } from 'node:test';

import { OsCredentialAnchorStore } from '../../src/main/crypto/credential-anchor.js';

describe('OS credential anchor platform contract (#311)', () => {
  test('unsupported platforms fail closed without a file fallback', () => {
    const store = new OsCredentialAnchorStore({ dataDir: '/profile/library', platform: 'aix' });
    assert.equal(store.isAvailable(), false);
    assert.equal(store.read(), null);
    store.clear();
    assert.throws(() => store.write({ libraryId: 'library-a', generation: 1, recordHash: '0'.repeat(64) }), /credential store refused/);
  });

  test('macOS availability requires the system security tool', () => {
    const store = new OsCredentialAnchorStore({ dataDir: '/profile/library', platform: 'darwin' });
    assert.equal(store.isAvailable(), existsSync('/usr/bin/security'));
  });

  test('Windows uses Credential Manager through a non-interactive PowerShell adapter', () => {
    const anchor = { libraryId: 'library-a', generation: 2, recordHash: 'a'.repeat(64) };
    const operations: { operation: string | undefined; value: string | undefined; command: string }[] = [];
    const spawn = ((command: string, _args: readonly string[], options?: { readonly env?: NodeJS.ProcessEnv }) => {
      const operation = options?.env?.['OVERLOOK_ANCHOR_OPERATION'];
      operations.push({ operation, value: options?.env?.['OVERLOOK_ANCHOR_VALUE'], command });
      const stdout = operation === 'read' ? `${JSON.stringify(anchor)}\n` : '';
      return { pid: 1, output: [null, stdout, ''], stdout, stderr: '', status: 0, signal: null };
    }) as unknown as typeof spawnSync;
    const store = new OsCredentialAnchorStore({ dataDir: 'C:\\profile\\library', platform: 'win32', spawn });

    assert.equal(store.isAvailable(), true);
    assert.deepEqual(store.read(), anchor);
    store.write(anchor);
    store.clear();
    assert.ok(operations.every(({ command }) => command === 'powershell.exe'));
    assert.deepEqual(
      operations.slice(1).map(({ operation }) => operation),
      ['read', 'write', 'clear'],
    );
    assert.equal(operations[2]?.value, JSON.stringify(anchor));
  });
});
