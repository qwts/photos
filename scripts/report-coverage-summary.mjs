#!/usr/bin/env node

// Renders a Markdown coverage summary for the PR run: c8 line/branch totals against the ratcheting
// floor from .c8rc.json. Appends to $GITHUB_STEP_SUMMARY when set (so it shows on the run's Checks
// tab), otherwise prints to stdout. This is a REPORTER, never a gate — it always exits 0; the
// actual coverage gate is c8's own check-coverage. It runs even when that gate fails, since a red
// run is exactly when you want to read the numbers.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rootDirectory = process.cwd();

async function readJson(relativePath) {
  // Never throw: a missing OR malformed input degrades to null so this reporter can't become a gate.
  try {
    return JSON.parse(await readFile(path.join(rootDirectory, relativePath), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Coverage summary: could not read ${relativePath} (${error?.message ?? error}); skipping it.`);
    }
    return null;
  }
}

function statusIcon(passed) {
  return passed ? '✅' : '❌';
}

function coverageRow(label, metric, floor) {
  if (!metric || typeof metric.pct !== 'number') {
    return `| ${label} | _n/a_ | ${floor ?? '—'} | — |`;
  }
  const pct = metric.pct.toFixed(2);
  const covered = `${metric.covered}/${metric.total}`;
  if (typeof floor !== 'number') {
    return `| ${label} | ${pct}% (${covered}) | — | — |`;
  }
  return `| ${label} | ${pct}% (${covered}) | ${floor}% | ${statusIcon(metric.pct >= floor)} |`;
}

function renderCoverageSection(summary, thresholds) {
  if (!summary?.total) {
    return ['### Code coverage', '', '_No `coverage/coverage-summary.json` found — the coverage step may not have run._'];
  }
  const { total } = summary;
  return [
    '### Code coverage',
    '',
    '| Metric | Covered | Floor | |',
    '| --- | --- | --- | --- |',
    coverageRow('Lines', total.lines, thresholds.lines),
    coverageRow('Branches', total.branches, thresholds.branches),
    coverageRow('Functions', total.functions, thresholds.functions),
    coverageRow('Statements', total.statements, thresholds.statements),
    '',
    '_Floors ratchet upward only (`.c8rc.json`); a ❌ fails the CI coverage gate._',
  ];
}

const [summary, c8Config] = await Promise.all([readJson('coverage/coverage-summary.json'), readJson('.c8rc.json')]);

const thresholds = {
  lines: c8Config?.lines,
  branches: c8Config?.branches,
  functions: c8Config?.functions,
  statements: c8Config?.statements,
};

// On GitHub Actions, surface each failed floor as an ::error annotation so the run summary names
// the failing metric instead of a blank "Error:" from the (separate, already-failed) c8 gate step.
// Annotations render regardless of this step's exit code, so this stays a reporter: still exit 0.
if (process.env.GITHUB_ACTIONS && summary?.total) {
  for (const [label, key] of [
    ['Lines', 'lines'],
    ['Branches', 'branches'],
    ['Functions', 'functions'],
    ['Statements', 'statements'],
  ]) {
    const metric = summary.total[key];
    const floor = thresholds[key];
    if (typeof metric?.pct === 'number' && typeof floor === 'number' && metric.pct < floor) {
      console.log(
        `::error title=Coverage::${label} coverage ${metric.pct.toFixed(2)}% is below the .c8rc.json floor of ${floor}% (covered ${metric.covered}/${metric.total}).`,
      );
    }
  }
}

const markdown = ['## Test coverage', '', ...renderCoverageSection(summary, thresholds), ''].join('\n');

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  try {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(summaryPath, `${markdown}\n`);
    console.log('Wrote coverage summary to the GitHub step summary.');
  } catch (error) {
    // Fall back to stdout rather than failing the step — this is a reporter, never a gate.
    console.warn(`Coverage summary: could not write the step summary (${error?.message ?? error}); printing instead.`);
    console.log(markdown);
  }
} else {
  console.log(markdown);
}
