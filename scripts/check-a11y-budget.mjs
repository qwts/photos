#!/usr/bin/env node

// Validates the accessibility violation budget (#398, ADR-0001) — the static half of the
// a11y gate. The RUNTIME half lives in .storybook/test-runner.ts and tests/e2e/a11y.spec.ts:
// they compare observed axe counts against this file and fail in both directions (over
// budget = regression, under budget = bank the win). Those lanes need a browser, so they
// cannot run inside `npm run ci`; this validator can, which is what keeps the budget
// honest between story runs.
//
// What this catches that the runtime lanes cannot:
//   - an entry pointing at a story/spec file that was renamed or deleted, which would
//     otherwise sit in the budget forever, silently permitting violations on a surface
//     that no longer exists;
//   - debt with no owner — an entry that names no issue is a number nobody will ever
//     come back for, which is how a ratchet quietly becomes a floor;
//   - a raised budget. Entries only shrink; the counts here are the audited baseline.
//
// Intentionally strict: the whole mechanism is a promise that a11y debt is written down
// and shrinking. A malformed budget that still exits 0 breaks that promise silently.

import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rootDirectory = process.cwd();
const BUDGET_PATH = 'tests/a11y/violation-budget.json';

// The WCAG 2.2 AA tag set the audit was run against. Pinned here as well as in the budget
// so a silent widening/narrowing of scope (which would move every count) fails review.
const REQUIRED_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const failures = [];

function fail(message) {
  failures.push(message);
}

async function pathExists(relativePath) {
  // Reject absolute paths and anything escaping the repo before touching the disk.
  if (path.isAbsolute(relativePath)) return false;
  const resolved = path.resolve(rootDirectory, relativePath);
  if (resolved !== rootDirectory && !resolved.startsWith(rootDirectory + path.sep)) return false;
  try {
    await stat(resolved);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

async function validateEntry(entry, { lane, pathKey, index }) {
  const label = `${lane}[${index}]`;

  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    fail(`${label}: "id" must be a non-empty string.`);
    return;
  }

  const where = `${lane} "${entry.id}"`;

  // A budgeted surface must point at the file that renders it. This is the closure that
  // stops orphaned debt: rename the story, and the gate makes you revisit the number.
  const filePath = entry[pathKey];
  if (typeof filePath !== 'string' || filePath.length === 0) {
    fail(`${where}: "${pathKey}" must be a non-empty string.`);
  } else if (!(await pathExists(filePath))) {
    fail(`${where}: "${pathKey}" points at ${filePath}, which does not exist. Delete the entry or fix the path.`);
  }

  // Zero is not a budget, it is the default — an explicit zero means someone fixed the
  // surface and left the tombstone behind.
  if (!isPositiveInteger(entry.violations)) {
    fail(`${where}: "violations" must be a positive integer (delete the entry when it reaches zero).`);
  }

  if (!Array.isArray(entry.issues) || entry.issues.length === 0) {
    fail(`${where}: "issues" must list at least one issue number — budgeted debt needs an owner.`);
  } else {
    for (const issue of entry.issues) {
      if (!isPositiveInteger(issue)) fail(`${where}: issue "${String(issue)}" is not a positive integer.`);
    }
  }

  if (typeof entry.note !== 'string' || entry.note.length === 0) {
    fail(`${where}: "note" must say which rules make up the count.`);
  }
}

async function main() {
  let budget;
  try {
    budget = JSON.parse(await readFile(path.resolve(rootDirectory, BUDGET_PATH), 'utf8'));
  } catch (error) {
    console.error(`A11y budget check failed: could not read ${BUDGET_PATH}.`);
    console.error(`  - ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const tags = budget.tags;
  if (!Array.isArray(tags) || REQUIRED_TAGS.some((tag) => !tags.includes(tag))) {
    fail(`"tags" must cover the audited WCAG 2.2 AA set: ${REQUIRED_TAGS.join(', ')}. Narrowing it would hide violations, not fix them.`);
  }

  for (const [lane, pathKey] of [
    ['stories', 'story'],
    ['flows', 'spec'],
  ]) {
    const entries = budget[lane];
    if (!Array.isArray(entries)) {
      fail(`"${lane}" must be an array.`);
      continue;
    }

    const seen = new Set();
    for (const [index, entry] of entries.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        fail(`${lane}[${index}]: must be an object.`);
        continue;
      }
      if (seen.has(entry.id)) fail(`${lane} "${entry.id}": duplicate entry — two budgets for one surface never both apply.`);
      seen.add(entry.id);
      await validateEntry(entry, { lane, pathKey, index });
    }
  }

  if (failures.length > 0) {
    console.error('A11y budget check failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  const storyCount = budget.stories.length;
  const flowCount = budget.flows.length;
  const total = [...budget.stories, ...budget.flows].reduce((sum, entry) => sum + entry.violations, 0);
  console.log(
    `A11y budget OK: ${total} known violation${total === 1 ? '' : 's'} across ` +
      `${storyCount} budgeted ${storyCount === 1 ? 'story' : 'stories'} and ${flowCount} ${flowCount === 1 ? 'flow' : 'flows'}.`,
  );
}

await main();
