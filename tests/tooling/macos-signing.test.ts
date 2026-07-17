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

  test('restricted Touch ID identity is isolated behind the provisioned package command', () => {
    const packageJson = JSON.parse(source('package.json')) as { readonly scripts?: Record<string, string> };
    const provisioned = source('build/entitlements.mac.provisioned.plist');
    const packager = source('scripts/package-signed-provisioned.mjs');
    for (const identity of ['Z5DM34QS5U', 'Z5DM34QS5U.com.zts1.overlook']) {
      assert.match(provisioned, new RegExp(identity, 'u'));
    }
    assert.match(packager, /Z5DM34QS5U/u);
    assert.match(packager, /com\.zts1\.overlook/u);
    assert.match(packageJson.scripts?.['package:signed:provisioned'] ?? '', /package-signed-provisioned\.mjs/u);
    assert.match(packager, /OVERLOOK_MAC_PROVISIONING_PROFILE/u);
    assert.match(packager, /provisioningProfile/u);
  });

  test('the package workflow validates that the packaged app can start', () => {
    const workflow = source('.github/workflows/package.yml');
    const knip = source('knip.json');
    assert.match(workflow, /verify-macos-app-launch\.mjs/u);
    assert.match(workflow, /\*-mac\.zip/u);
    assert.match(source('scripts/verify-macos-app-launch.mjs'), /ditto/u);
    for (const binary of ['ditto', 'plutil', 'security']) assert.match(knip, new RegExp(binary, 'u'));
  });
});
