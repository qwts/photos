#!/usr/bin/env node

// Fails lint when a package.json dependency uses anything but an exact version pin.
// Dependabot owns upgrades; humans don't hand-edit ranges. (Stricter than image-trail's
// "latest"-only ban, per the Overlook tooling epic: ^/~/ranges/tags all fail.)

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', '.test-dist', 'coverage', '.claude']);

// Exact semver only: MAJOR.MINOR.PATCH with optional prerelease/build metadata.
const EXACT_PIN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

async function findPackageManifests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        manifests.push(...(await findPackageManifests(entryPath)));
      }
      continue;
    }

    if (entry.isFile() && entry.name === 'package.json') {
      manifests.push(entryPath);
    }
  }

  return manifests;
}

function collectUnpinnedDependencies(manifestPath, manifest) {
  const violations = [];

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      continue;
    }

    for (const [dependencyName, version] of Object.entries(dependencies)) {
      if (typeof version !== 'string' || !EXACT_PIN.test(version)) {
        violations.push({ dependencyName, field, manifestPath, version });
      }
    }
  }

  return violations;
}

const rootDirectory = process.cwd();
const manifestPaths = (await findPackageManifests(rootDirectory)).sort();
const violations = [];

for (const manifestPath of manifestPaths) {
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  violations.push(...collectUnpinnedDependencies(manifestPath, manifest));
}

if (violations.length > 0) {
  console.error('Dependencies must use exact version pins (Dependabot owns upgrades). Found:');
  for (const { dependencyName, field, manifestPath, version } of violations) {
    console.error(`- ${path.relative(rootDirectory, manifestPath)}: ${field}.${dependencyName} = "${version}"`);
  }
  process.exit(1);
}

console.log(`Checked ${manifestPaths.length} package manifest${manifestPaths.length === 1 ? '' : 's'} for exact dependency pins.`);
