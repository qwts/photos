#!/usr/bin/env node

// Generate THIRD-PARTY-NOTICES.md — the attribution file for every third-party
// package shipped in a packaged Overlook build (#461). Run it after dependency
// changes; CI's license-policy gate (#462) fails if the committed file drifts
// from what this would produce.
//
//   npm run licenses:notices        # regenerate the committed file
//   npm run licenses:notices -- --check   # exit non-zero if it is stale

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { resolveShippedClosure } from './dependency-closure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NOTICES_PATH = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');

const HEADER = `# Third-Party Notices

Overlook is distributed as a packaged desktop application that bundles the
third-party software listed below. This file is generated — do not edit it by
hand. Regenerate it with \`npm run licenses:notices\` after changing
dependencies.

The bundled Electron runtime additionally embeds Chromium, Node.js, and other
components; their full license texts ship inside the Electron distribution at
\`LICENSES.chromium.html\` and are incorporated here by reference.
`;

export function renderNotices(closure) {
  const summary = closure.map((pkg) => `| \`${pkg.name}\` | ${pkg.version} | ${pkg.license} |`).join('\n');

  const details = closure
    .map((pkg) => {
      const heading = `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license}`;
      const body = pkg.licenseText
        ? `\n\n\`\`\`\n${pkg.licenseText}\n\`\`\``
        : pkg.conditional
          ? '\n\n_Optional/platform-specific package; its full license text ships alongside the binary in the build variant that bundles it._'
          : '\n\n_No license text file was found in the published package._';
      return `${heading}${body}`;
    })
    .join('\n\n---\n\n');

  return `${HEADER}
## Summary

| Package | Version | License |
| ------- | ------- | ------- |
${summary}

---

${details}
`;
}

export function currentNotices() {
  try {
    return readFileSync(NOTICES_PATH, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  const closure = resolveShippedClosure();
  const rendered = renderNotices(closure);
  const check = process.argv.includes('--check');

  if (check) {
    if (currentNotices() !== rendered) {
      console.error(`THIRD-PARTY-NOTICES.md is stale (covers ${closure.length} packages). Run: npm run licenses:notices`);
      process.exit(1);
    }
    console.log(`THIRD-PARTY-NOTICES.md is up to date (${closure.length} packages).`);
    return;
  }

  writeFileSync(NOTICES_PATH, rendered);
  console.log(`Wrote THIRD-PARTY-NOTICES.md for ${closure.length} shipped packages.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
