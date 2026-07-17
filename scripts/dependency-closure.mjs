#!/usr/bin/env node

// Resolve the set of third-party packages actually shipped in a packaged
// Overlook build, for licensing compliance (#461) and the license-policy gate
// (#462). Both the notices generator and the checker import from here so they
// audit exactly the same closure.
//
// "Shipped" is NOT `devDependencies`: electron-vite inlines JS dependencies
// into the bundles and electron-builder copies native modules, so the shipped
// set is the production closure of `dependencies` + `optionalDependencies`,
// resolved through each package's own production dependencies. `electron` is a
// devDependency by electron-builder convention but its runtime IS shipped, so
// it is added explicitly as a bundled runtime root.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// devDependencies whose runtime nonetheless ships inside the packaged app.
export const BUNDLED_RUNTIME_ROOTS = ['electron'];

const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|copying|notice|unlicense)(?:[.-].*)?$/iu;

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Walk up the node_modules chain from `fromDir` (npm hoists most packages to
// the root, but nested installs and multiple versions still happen).
function resolvePackageDir(name, fromDir) {
  const segments = name.split('/');
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...segments);
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir || !dir.startsWith(ROOT)) {
      break;
    }
    dir = parent;
  }
  return null;
}

// Normalize the many shapes of the `license`/`licenses` manifest fields into a
// single SPDX-ish string. `UNKNOWN` when a package declares nothing.
export function normalizeLicense(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim() !== '') {
    return manifest.license.trim();
  }
  if (manifest.license && typeof manifest.license === 'object' && typeof manifest.license.type === 'string') {
    return manifest.license.type;
  }
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses.map((entry) => (typeof entry === 'string' ? entry : entry?.type)).filter(Boolean);
    if (types.length > 0) {
      return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
    }
  }
  return 'UNKNOWN';
}

function readLicenseText(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const file = entries.find((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name));
  if (!file) {
    return null;
  }
  try {
    return readFileSync(path.join(dir, file.name), 'utf8').trim();
  } catch {
    return null;
  }
}

function productionDeps(manifest) {
  return { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) };
}

/**
 * Resolve the shipped third-party closure as a sorted array of records:
 * `{ name, version, license, licenseText, path }` (repo-relative `path`).
 * The root package (`private: true`) is excluded — it is first-party.
 */
export function resolveShippedClosure() {
  const rootManifest = readManifest(ROOT);
  if (!rootManifest) {
    throw new Error('Cannot read root package.json');
  }

  const rootDeps = productionDeps(rootManifest);
  const seen = new Map();
  const queue = [];

  for (const name of [...Object.keys(rootDeps), ...BUNDLED_RUNTIME_ROOTS]) {
    queue.push({ name, fromDir: ROOT });
  }

  while (queue.length > 0) {
    const { name, fromDir } = queue.shift();
    const dir = resolvePackageDir(name, fromDir);
    if (!dir) {
      // A pruned optional dependency (e.g. platform-specific) that isn't
      // installed here cannot ship from this build; skip rather than fail.
      continue;
    }
    const manifest = readManifest(dir);
    if (!manifest || manifest.name === rootManifest.name) {
      continue;
    }
    const key = `${manifest.name}@${manifest.version}`;
    if (seen.has(key)) {
      continue;
    }
    seen.set(key, {
      name: manifest.name,
      version: manifest.version ?? '0.0.0',
      license: normalizeLicense(manifest),
      licenseText: readLicenseText(dir),
      path: path.relative(ROOT, dir),
    });
    // Bundled-runtime roots (electron) are leaves: the shipped artifact is the
    // downloaded runtime binary, whose embedded third-party licenses live in
    // its own LICENSES.chromium.html (referenced from the notices header). The
    // npm package's own dependencies are install-time tooling that never ships,
    // so recursing into them would attribute software that isn't distributed.
    if (BUNDLED_RUNTIME_ROOTS.includes(manifest.name)) {
      continue;
    }
    for (const dep of Object.keys(productionDeps(manifest))) {
      queue.push({ name: dep, fromDir: dir });
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
