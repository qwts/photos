#!/usr/bin/env node

// Hardcoded user-facing string ratchet (#403, ADR-0020 §6; ADR-0001 ratchet
// pattern). A shrink-only, per-file budget of remaining unextracted literals —
// the inverse promise of the a11y violation budget (tests/a11y/violation-budget.json):
// every count may only DROP, an unlisted file is budgeted at ZERO, and a file
// UNDER its listed count also fails, demanding the number be tightened. That is
// what forces migration forward instead of letting new hardcoded copy hide
// behind existing debt.
//
// Detection reuses eslint-plugin-formatjs's `no-literal-string-in-jsx` (the
// plugin is already registered for renderer files in eslint.config.js), flipped
// on here so `eslint .` stays quiet for everyday runs.
//
//   node scripts/check-i18n-budget.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_PATH = path.join(ROOT, 'tests', 'i18n', 'string-budget.json');
const RULE_ID = 'formatjs/no-literal-string-in-jsx';

// Renderer source only. Stories and tests are fixtures (ADR §6 excludes them,
// mirroring the lint config's treatment of tests/fixtures/**).
const LINT_GLOBS = ['src/renderer/src/**/*.ts', 'src/renderer/src/**/*.tsx'];
const isFixture = (file) => /\.(?:stories|test)\.tsx?$/u.test(file);

const failures = [];
const fail = (message) => failures.push(message);

/** Per-file count of remaining hardcoded JSX literals, keyed by repo-relative path. */
async function measure() {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: { rules: { [RULE_ID]: 'error' } },
  });
  const results = await eslint.lintFiles(LINT_GLOBS);
  const counts = new Map();
  for (const result of results) {
    const rel = path.relative(ROOT, result.filePath);
    if (isFixture(rel)) continue;
    const hits = result.messages.filter((m) => m.ruleId === RULE_ID).length;
    if (hits > 0) counts.set(rel, hits);
  }
  return counts;
}

function loadBudget() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
  } catch (error) {
    fail(`Cannot read ${path.relative(ROOT, BUDGET_PATH)}: ${error.message}`);
    return new Map();
  }
  const budget = new Map();
  for (const entry of raw.files ?? []) {
    if (typeof entry.file !== 'string' || entry.file === '') {
      fail(`Budget entry missing a "file": ${JSON.stringify(entry)}`);
      continue;
    }
    if (!Number.isInteger(entry.count) || entry.count <= 0) {
      fail(`${entry.file}: "count" must be a positive integer (drop the entry when it hits 0).`);
      continue;
    }
    if (!Array.isArray(entry.issues) || entry.issues.length === 0) {
      fail(`${entry.file}: "issues" must name the issue(s) that own the remaining strings.`);
      continue;
    }
    if (budget.has(entry.file)) fail(`${entry.file}: duplicate budget entry.`);
    budget.set(entry.file, entry.count);
  }
  return budget;
}

function reconcile(actual, budget) {
  for (const [file, count] of actual) {
    const allowed = budget.get(file) ?? 0;
    if (count > allowed) {
      fail(`${file}: ${count} hardcoded string(s), budget ${allowed}. Migrate them to the catalog (ADR-0020 §6).`);
    }
  }
  for (const [file, allowed] of budget) {
    const count = actual.get(file) ?? 0;
    if (count < allowed) {
      fail(
        `${file}: only ${count} hardcoded string(s) now (budget ${allowed}). Tighten the budget to ${count}${count === 0 ? ' (delete the entry)' : ''}.`,
      );
    }
  }
}

const actual = await measure();
const budget = loadBudget();
reconcile(actual, budget);

if (failures.length > 0) {
  console.error('i18n hardcoded-string ratchet failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`i18n string ratchet: ${actual.size} file(s) with remaining literals, all within budget.`);
