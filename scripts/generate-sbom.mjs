#!/usr/bin/env node

// Emit a CycloneDX SBOM for the shipped dependency closure (#462) as a release
// artifact, so every distributed build has a machine-readable bill of
// materials. Wired into the `package*` scripts after electron-builder runs.
//
//   npm run licenses:sbom   # writes release/sbom.cyclonedx.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveShippedClosure } from './dependency-closure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'release', 'sbom.cyclonedx.json');

const rootManifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function purl(name, version) {
  const [scope, unscoped] = name.startsWith('@') ? name.split('/') : [null, name];
  const namespace = scope ? `${encodeURIComponent(scope)}/` : '';
  return `pkg:npm/${namespace}${encodeURIComponent(unscoped)}@${version}`;
}

// CycloneDX distinguishes a single SPDX id from a compound expression.
function licenseEntry(expression) {
  if (expression === 'UNKNOWN') {
    return [{ license: { name: 'UNKNOWN' } }];
  }
  if (/\b(?:AND|OR|WITH)\b|[()]/u.test(expression)) {
    return [{ expression }];
  }
  return [{ license: { id: expression } }];
}

function main() {
  const closure = resolveShippedClosure();
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: rootManifest.name,
        version: rootManifest.version,
        ...(rootManifest.license ? { licenses: [{ license: { id: rootManifest.license } }] } : {}),
      },
    },
    components: closure.map((pkg) => ({
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      purl: purl(pkg.name, pkg.version),
      licenses: licenseEntry(pkg.license),
    })),
  };

  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} — ${closure.length} components.`);
}

main();
