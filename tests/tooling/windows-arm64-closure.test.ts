import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.cwd();

interface ClosureRecord {
  readonly name: string;
  readonly version: string;
}

interface DependencyClosureModule {
  readonly resolveShippedClosure: () => readonly ClosureRecord[];
}

function dependencyClosureModule(): Promise<DependencyClosureModule> {
  return import(pathToFileURL(join(root, 'scripts/dependency-closure.mjs')).href) as Promise<DependencyClosureModule>;
}

// Slice 4 guard (#683): the shipped closure is resolved from the lockfile union
// of platform variants, so it is arch-independent and already carries the ARM64
// Windows native payloads. That is exactly what the SBOM and THIRD-PARTY-NOTICES
// enumerate, so publishing an ARM64 installer needs no closure change — but a
// future sharp bump could drop the win32-arm64 variant, silently shipping an
// ARM64 build whose SBOM omits its own native payload. Pin the invariant.
describe('Windows ARM64 dependency closure (#683)', () => {
  test('the shipped closure includes the ARM64 sharp native payload alongside x64', async () => {
    const { resolveShippedClosure } = await dependencyClosureModule();
    const names = new Set(resolveShippedClosure().map((record) => record.name));
    assert.ok(names.has('@img/sharp-win32-arm64'), 'ARM64 sharp payload must be in the SBOM/notices closure');
    assert.ok(names.has('@img/sharp-win32-x64'), 'x64 sharp payload must remain in the closure');
  });

  test('the encrypted SQLite package is shipped (its per-arch prebuild is arch-verified at package time)', async () => {
    const { resolveShippedClosure } = await dependencyClosureModule();
    const names = new Set(resolveShippedClosure().map((record) => record.name));
    assert.ok(names.has('better-sqlite3-multiple-ciphers'), 'encrypted SQLite must be in the shipped closure');
  });
});
