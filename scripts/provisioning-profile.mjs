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
  if ((expected.iCloudContainerId === undefined) !== (expected.ubiquityContainerId === undefined)) {
    throw new Error('expected iCloud and ubiquity container identifiers must be provided together');
  }
  if (metadata.entitlements?.['com.apple.application-identifier'] !== expected.applicationId) {
    throw new Error(`profile does not authorize application identifier ${expected.applicationId}`);
  }
  if (metadata.entitlements?.['com.apple.developer.team-identifier'] !== expected.teamId) {
    throw new Error(`profile does not authorize team ${expected.teamId}`);
  }
  if (!Array.isArray(metadata.teams) || !metadata.teams.includes(expected.teamId)) {
    throw new Error(`profile TeamIdentifier does not contain ${expected.teamId}`);
  }
  if (expected.iCloudContainerId !== undefined || expected.ubiquityContainerId !== undefined) {
    const containers = metadata.entitlements?.['com.apple.developer.icloud-container-identifiers'];
    const ubiquityContainers = metadata.entitlements?.['com.apple.developer.ubiquity-container-identifiers'];
    const services = metadata.entitlements?.['com.apple.developer.icloud-services'];
    if (expected.iCloudContainerId === undefined || !Array.isArray(containers) || !containers.includes(expected.iCloudContainerId)) {
      throw new Error(`profile does not authorize iCloud container ${expected.iCloudContainerId}`);
    }
    if (
      expected.ubiquityContainerId === undefined ||
      !Array.isArray(ubiquityContainers) ||
      !ubiquityContainers.includes(expected.ubiquityContainerId)
    ) {
      throw new Error(`profile does not authorize ubiquity container ${expected.ubiquityContainerId}`);
    }
    if (!Array.isArray(services) || !services.includes('CloudDocuments')) {
      throw new Error('profile does not authorize iCloud Documents');
    }
  }
  if (!Number.isFinite(metadata.expiresAt) || metadata.expiresAt <= now) {
    throw new Error('provisioning profile is expired or has no valid expiry');
  }
}
