import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readProvisioningProfile, validateProvisioningProfile } from './provisioning-profile.mjs';

const TEAM_ID = 'Z5DM34QS5U';
const APPLICATION_ID = `${TEAM_ID}.com.zts1.overlook`;
const profile = process.env['OVERLOOK_MAC_PROVISIONING_PROFILE'];

function fail(message) {
  console.error(`[overlook] ${message}`);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('provisioned signing is supported only on macOS');
if (profile === undefined || profile === '') fail('OVERLOOK_MAC_PROVISIONING_PROFILE is required');

const profilePath = resolve(profile);
if (!existsSync(profilePath)) fail(`provisioning profile does not exist: ${profilePath}`);

let metadata;
try {
  metadata = readProvisioningProfile(profilePath);
} catch (error) {
  fail(`provisioning profile is malformed: ${error instanceof Error ? error.message : 'unknown error'}`);
}

try {
  validateProvisioningProfile(metadata, { applicationId: APPLICATION_ID, teamId: TEAM_ID });
} catch (error) {
  fail(error instanceof Error ? error.message : 'provisioning profile validation failed');
}

if (process.argv.includes('--validate-only')) {
  console.log(`[overlook] provisioning profile is valid for ${APPLICATION_ID} through ${new Date(metadata.expiresAt).toISOString()}`);
  process.exit(0);
}

const result = spawnSync(
  'electron-builder',
  ['--publish', 'never', '-c.mac.entitlements=build/entitlements.mac.provisioned.plist', `-c.mac.provisioningProfile=${profilePath}`],
  { stdio: 'inherit' },
);
if (result.error !== undefined) fail(`electron-builder failed to start: ${result.error.message}`);
process.exit(result.status ?? 1);
