import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readProvisioningProfile, validateProvisioningProfile } from './provisioning-profile.mjs';

const TEAM_ID = 'Z5DM34QS5U';
const BUNDLE_ID = 'com.zts1.overlook';
const APPLICATION_ID = `${TEAM_ID}.${BUNDLE_ID}`;
const BIOMETRIC_REASON = 'Unlock Overlook with Touch ID.';

function fail(message) {
  console.error(`[overlook] provisioned app verification failed: ${message}`);
  process.exit(1);
}

function plistValue(path, key) {
  try {
    return String(
      execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    ).trim();
  } catch {
    fail(`Info.plist key ${key} is missing or unreadable`);
  }
}

function signedEntitlements(path) {
  // macOS 15's default abstract display reads the active DER entitlement
  // representation. Do not force --xml: modern signatures need not carry a
  // usable legacy XML blob.
  const result = spawnSync('codesign', ['-d', '--entitlements', '-', path], { encoding: 'utf8' });
  if (result.error !== undefined) fail(`codesign could not inspect ${path}: ${result.error.message}`);
  if (result.status !== 0) fail(`codesign could not read entitlements for ${path}`);
  return result.stdout;
}

function stringEntitlement(source, key) {
  const marker = `[Key] ${key}`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const next = source.indexOf('\n\t[Key] ', start + marker.length);
  const block = source.slice(start, next < 0 ? undefined : next);
  return /\[String\] ([^\n]+)/u.exec(block)?.[1]?.trim() ?? null;
}

if (process.platform !== 'darwin') fail('verification is supported only on macOS');
const argument = process.argv[2];
if (argument === undefined || argument === '') fail('pass the packaged .app path');
const appPath = resolve(argument);
if (!existsSync(appPath)) fail(`app does not exist: ${appPath}`);

const infoPath = join(appPath, 'Contents', 'Info.plist');
if (plistValue(infoPath, 'CFBundleIdentifier') !== BUNDLE_ID) fail(`Info.plist bundle identifier is not ${BUNDLE_ID}`);
if (plistValue(infoPath, 'NSFaceIDUsageDescription') !== BIOMETRIC_REASON) {
  fail('Info.plist biometric usage description is missing or unexpected');
}

const profilePath = join(appPath, 'Contents', 'embedded.provisionprofile');
if (!existsSync(profilePath)) fail('embedded.provisionprofile is missing');
try {
  const profile = readProvisioningProfile(profilePath);
  validateProvisioningProfile(profile, { applicationId: APPLICATION_ID, teamId: TEAM_ID });
} catch (error) {
  fail(`embedded profile is invalid: ${error instanceof Error ? error.message : 'unknown error'}`);
}

const mainEntitlements = signedEntitlements(appPath);
if (stringEntitlement(mainEntitlements, 'com.apple.application-identifier') !== APPLICATION_ID) {
  fail(`main executable lacks application identifier ${APPLICATION_ID}`);
}
if (stringEntitlement(mainEntitlements, 'com.apple.developer.team-identifier') !== TEAM_ID) {
  fail(`main executable lacks team identifier ${TEAM_ID}`);
}

const rendererHelper = join(appPath, 'Contents', 'Frameworks', 'Overlook Helper (Renderer).app');
const helperEntitlements = signedEntitlements(rendererHelper);
for (const key of ['com.apple.application-identifier', 'com.apple.developer.team-identifier']) {
  if (stringEntitlement(helperEntitlements, key) !== null) fail(`renderer helper unexpectedly claims ${key}`);
}

console.log(`[overlook] provisioned app identity verified for ${APPLICATION_ID}`);
