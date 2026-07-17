import { execFileSync } from 'node:child_process';

function commandText(run, file, args, options) {
  return String(run(file, args, { ...options, encoding: 'utf8' })).trim();
}

export function readProvisioningProfile(profilePath, run = execFileSync) {
  const plist = run('security', ['cms', '-D', '-i', profilePath]);
  const extracted = (key, format) =>
    commandText(run, 'plutil', ['-extract', key, format, '-o', '-', '-'], {
      input: plist,
    });

  return {
    entitlements: JSON.parse(extracted('Entitlements', 'json')),
    teams: JSON.parse(extracted('TeamIdentifier', 'json')),
    expiresAt: Date.parse(extracted('ExpirationDate', 'raw')),
  };
}

export function validateProvisioningProfile(metadata, expected, now = Date.now()) {
  if (metadata.entitlements?.['com.apple.application-identifier'] !== expected.applicationId) {
    throw new Error(`profile does not authorize application identifier ${expected.applicationId}`);
  }
  if (metadata.entitlements?.['com.apple.developer.team-identifier'] !== expected.teamId) {
    throw new Error(`profile does not authorize team ${expected.teamId}`);
  }
  if (!Array.isArray(metadata.teams) || !metadata.teams.includes(expected.teamId)) {
    throw new Error(`profile TeamIdentifier does not contain ${expected.teamId}`);
  }
  if (!Number.isFinite(metadata.expiresAt) || metadata.expiresAt <= now) {
    throw new Error('provisioning profile is expired or has no valid expiry');
  }
}
