import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const TEAM_ID = 'Z5DM34QS5U';
const APPLICATION_ID = `${TEAM_ID}.com.qwts.overlook`;
const profile = process.env['OVERLOOK_MAC_PROVISIONING_PROFILE'];

function fail(message) {
  console.error(`[overlook] ${message}`);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('provisioned signing is supported only on macOS');
if (profile === undefined || profile === '') fail('OVERLOOK_MAC_PROVISIONING_PROFILE is required');

const profilePath = resolve(profile);
if (!existsSync(profilePath)) fail(`provisioning profile does not exist: ${profilePath}`);

let payload;
try {
  const plist = execFileSync('security', ['cms', '-D', '-i', profilePath]);
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' });
  payload = JSON.parse(json);
} catch (error) {
  fail(`provisioning profile is malformed: ${error instanceof Error ? error.message : 'unknown error'}`);
}

const entitlements = payload?.Entitlements;
const teams = payload?.TeamIdentifier;
const expiresAt = Date.parse(payload?.ExpirationDate ?? '');
if (entitlements?.['com.apple.application-identifier'] !== APPLICATION_ID) {
  fail(`profile does not authorize application identifier ${APPLICATION_ID}`);
}
if (entitlements?.['com.apple.developer.team-identifier'] !== TEAM_ID) {
  fail(`profile does not authorize team ${TEAM_ID}`);
}
if (!Array.isArray(teams) || !teams.includes(TEAM_ID)) fail(`profile TeamIdentifier does not contain ${TEAM_ID}`);
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) fail('provisioning profile is expired or has no valid expiry');

const result = spawnSync(
  'electron-builder',
  ['--publish', 'never', '-c.mac.entitlements=build/entitlements.mac.provisioned.plist', `-c.mac.provisioningProfile=${profilePath}`],
  { stdio: 'inherit' },
);
if (result.error !== undefined) fail(`electron-builder failed to start: ${result.error.message}`);
process.exit(result.status ?? 1);
