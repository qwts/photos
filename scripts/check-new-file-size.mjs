#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Keep in sync with the ESLint `max-lines` error in eslint.config.js — both enforce the
// same 800-line budget. This script guards NEW files (added on the branch + untracked)
// before ESLint ever sees them; the ESLint rule is what stops EXISTING files growing
// past the cap. This one counts physical lines; ESLint skips blanks/comments, so ESLint
// is the slightly looser bound and this is the hard ceiling for brand-new files.
const DEFAULT_MAX_LINES = 800;
const GUARDED_SOURCE = /^(src|tests|scripts)\/.*\.(ts|tsx|js|mjs|css)$/u;
const IGNORED_PATH = /^(\.test-dist|\.test-dist-dom|coverage|dist|node_modules)\//u;

function splitList(value) {
  return (value ?? '')
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function countLines(text) {
  if (text.length === 0) return 0;
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const withoutFinalBreak = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return withoutFinalBreak.length === 0 ? 0 : withoutFinalBreak.split('\n').length;
}

export function isGuardedNewFile(file) {
  return GUARDED_SOURCE.test(file) && !IGNORED_PATH.test(file);
}

export function evaluateNewFileSizes({ files, readText, maxLines = DEFAULT_MAX_LINES }) {
  const failures = [];
  for (const file of files.filter(isGuardedNewFile)) {
    const lines = countLines(readText(file));
    if (lines > maxLines) failures.push({ file, lines, maxLines });
  }
  return { ok: failures.length === 0, failures };
}

function resolveBaseRef() {
  for (const ref of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' });
      return ref;
    } catch {
      continue;
    }
  }
  return null;
}

function gatherAddedFiles() {
  if (process.env.NEW_FILE_SIZE_CHECK_FILES) return splitList(process.env.NEW_FILE_SIZE_CHECK_FILES);
  const baseRef = resolveBaseRef();
  if (!baseRef) {
    console.log('No origin/main or main ref found; skipping new-file size check.');
    return null;
  }
  let mergeBase;
  try {
    mergeBase = execFileSync('git', ['merge-base', 'HEAD', baseRef], { encoding: 'utf8' }).trim();
  } catch {
    console.log(`Could not compute a merge-base with ${baseRef}; skipping new-file size check.`);
    return null;
  }
  const addedFiles = splitList(
    execFileSync('git', ['diff', '--name-only', '--diff-filter=A', `${mergeBase}...HEAD`], { encoding: 'utf8' }),
  );
  // Staged-but-uncommitted additions are in neither the commit range nor --others;
  // without this, an oversized `git add`ed file passes lint until after the commit.
  const stagedFiles = splitList(execFileSync('git', ['diff', '--name-only', '--diff-filter=A', '--cached'], { encoding: 'utf8' }));
  const untrackedFiles = splitList(execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }));
  return [...new Set([...addedFiles, ...stagedFiles, ...untrackedFiles])];
}

function main() {
  const files = gatherAddedFiles();
  if (!files) return;
  const result = evaluateNewFileSizes({ files, readText: (file) => readFileSync(file, 'utf8') });
  if (result.ok) {
    console.log('New-file size check OK.');
    return;
  }
  console.error('New-file size check failed. Split oversized files before review:');
  for (const failure of result.failures) {
    console.error(`  - ${failure.file}: ${failure.lines} lines (max ${failure.maxLines})`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
