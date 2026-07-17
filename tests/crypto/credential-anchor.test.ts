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
    const operations: { operation: string | undefined; target: string | undefined; value: string | undefined; command: string }[] = [];
    const spawn = ((command: string, _args: readonly string[], options?: { readonly env?: NodeJS.ProcessEnv }) => {
      const operation = options?.env?.['OVERLOOK_ANCHOR_OPERATION'];
      operations.push({
        operation,
        target: options?.env?.['OVERLOOK_ANCHOR_TARGET'],
        value: options?.env?.['OVERLOOK_ANCHOR_VALUE'],
        command,
      });
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
      ['read', 'write', 'clear', 'clear'],
    );
    assert.equal(operations[2]?.value, JSON.stringify(anchor));
    assert.match(operations[1]?.target ?? '', /^com\.zts1\.overlook\.app-lock-anchor:/u);
    assert.match(operations[4]?.target ?? '', /^com\.qwts\.overlook\.app-lock-anchor:/u);
  });

  test('legacy service is copied to the canonical service without deleting legacy custody', () => {
    const anchor = { libraryId: 'library-a', generation: 3, recordHash: 'b'.repeat(64) };
    const services: string[] = [];
    const spawn = ((_command: string, args: readonly string[]) => {
      const serviceIndex = args.indexOf('-s');
      const service = serviceIndex >= 0 ? args[serviceIndex + 1] : undefined;
      if (service !== undefined) services.push(service);
      const operation = args[0];
      const foundLegacy = operation === 'find-generic-password' && service === 'com.qwts.overlook.app-lock-anchor';
      const stdout = foundLegacy ? `${JSON.stringify(anchor)}\n` : '';
      const status = foundLegacy || operation === 'add-generic-password' ? 0 : 44;
      return { pid: 1, output: [null, stdout, ''], stdout, stderr: '', status, signal: null };
    }) as unknown as typeof spawnSync;
    const store = new OsCredentialAnchorStore({ dataDir: '/profile/library', platform: 'darwin', spawn });

    assert.deepEqual(store.read(), anchor);
    assert.deepEqual(services, [
      'com.zts1.overlook.app-lock-anchor',
      'com.qwts.overlook.app-lock-anchor',
      'com.zts1.overlook.app-lock-anchor',
    ]);
  });

  test('a corrupt canonical anchor fails closed instead of rolling back to legacy', () => {
    const services: string[] = [];
    const spawn = ((_command: string, args: readonly string[]) => {
      const serviceIndex = args.indexOf('-s');
      const service = serviceIndex >= 0 ? args[serviceIndex + 1] : undefined;
      if (service !== undefined) services.push(service);
      return { pid: 1, output: [null, 'corrupt', ''], stdout: 'corrupt', stderr: '', status: 0, signal: null };
    }) as unknown as typeof spawnSync;
    const store = new OsCredentialAnchorStore({ dataDir: '/profile/library', platform: 'darwin', spawn });

    assert.equal(store.read(), null);
    assert.deepEqual(services, ['com.zts1.overlook.app-lock-anchor']);
  });
});

describe('Windows credential anchor identity migration (#374)', () => {
  test('missing canonical service falls through to and copies legacy custody', () => {
    const anchor = { libraryId: 'library-a', generation: 4, recordHash: 'c'.repeat(64) };
    const operations: { operation: string | undefined; target: string | undefined; value: string | undefined }[] = [];
    const spawn = ((_command: string, _args: readonly string[], options?: { readonly env?: NodeJS.ProcessEnv }) => {
      const operation = options?.env?.['OVERLOOK_ANCHOR_OPERATION'];
      const target = options?.env?.['OVERLOOK_ANCHOR_TARGET'];
      const value = options?.env?.['OVERLOOK_ANCHOR_VALUE'];
      operations.push({ operation, target, value });
      const stdout =
        operation === 'read'
          ? target?.startsWith('com.zts1.overlook.app-lock-anchor:') === true
            ? '__OVERLOOK_CREDENTIAL_NOT_FOUND__'
            : JSON.stringify(anchor)
          : '';
      return { pid: 1, output: [null, stdout, ''], stdout, stderr: '', status: 0, signal: null };
    }) as unknown as typeof spawnSync;
    const store = new OsCredentialAnchorStore({ dataDir: 'C:\\profile\\library', platform: 'win32', spawn });

    assert.deepEqual(store.read(), anchor);
    assert.deepEqual(
      operations.map(({ operation }) => operation),
      ['read', 'read', 'write'],
    );
    assert.match(operations[0]?.target ?? '', /^com\.zts1\.overlook\.app-lock-anchor:/u);
    assert.match(operations[1]?.target ?? '', /^com\.qwts\.overlook\.app-lock-anchor:/u);
    assert.equal(operations[2]?.value, JSON.stringify(anchor));
  });

  test('corrupt canonical service fails closed without probing legacy custody', () => {
    const operations: string[] = [];
    const spawn = ((_command: string, _args: readonly string[], options?: { readonly env?: NodeJS.ProcessEnv }) => {
      operations.push(options?.env?.['OVERLOOK_ANCHOR_TARGET'] ?? '');
      return { pid: 1, output: [null, '', ''], stdout: '', stderr: '', status: 0, signal: null };
    }) as unknown as typeof spawnSync;
    const store = new OsCredentialAnchorStore({ dataDir: 'C:\\profile\\library', platform: 'win32', spawn });

    assert.equal(store.read(), null);
    assert.equal(operations.length, 1);
    assert.match(operations[0] ?? '', /^com\.zts1\.overlook\.app-lock-anchor:/u);
  });
});
