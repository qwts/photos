import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('macOS release signing safety (#357)', () => {
  test('the default Developer ID build claims no profile-restricted identity entitlements', () => {
    const entitlements = source('build/entitlements.mac.plist');
    assert.doesNotMatch(entitlements, /com\.apple\.application-identifier/u);
    assert.doesNotMatch(entitlements, /com\.apple\.developer\.team-identifier/u);
  });

  test('the package workflow validates that the packaged app can start', () => {
    const workflow = source('.github/workflows/package.yml');
    assert.match(workflow, /verify-macos-app-launch\.mjs/u);
  });
});
