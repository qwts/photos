#!/usr/bin/env node

// License-policy gate (#462): fail CI when a package in the shipped dependency
// closure carries a license that is neither on the allowlist nor a reviewed
// exception. Keeps licensing compliance (#461) enforced instead of drifting.
//
//   npm run lint:licenses   # runs this, then the notices-freshness check

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { resolveShippedClosure } from './dependency-closure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = path.join(ROOT, '.license-policy.json');

const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
const allowed = new Set(policy.allowed);
const exceptions = policy.exceptions ?? {};

// Evaluate a (small) SPDX expression against the allowlist. Supports the shapes
// dependencies actually use: single ids, parenthesized groups, `OR` (any branch
// satisfies), `AND` (every operand must), and `WITH` exception suffixes.
function isSatisfiable(expression) {
  const expr = expression.trim();
  if (expr === '') {
    return false;
  }
  // Strip one layer of wrapping parentheses when balanced across the whole expr.
  if (expr.startsWith('(') && expr.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < expr.length; i += 1) {
      if (expr[i] === '(') depth += 1;
      else if (expr[i] === ')') {
        depth -= 1;
        if (depth === 0 && i < expr.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (wraps) {
      return isSatisfiable(expr.slice(1, -1));
    }
  }
  const or = splitTopLevel(expr, 'OR');
  if (or.length > 1) {
    return or.some(isSatisfiable);
  }
  const and = splitTopLevel(expr, 'AND');
  if (and.length > 1) {
    return and.every(isSatisfiable);
  }
  const license = expr
    .split(/\bWITH\b/u)[0]
    .trim()
    .replace(/^\(|\)$/gu, '')
    .trim();
  return allowed.has(license);
}

function splitTopLevel(expr, operator) {
  const parts = [];
  let depth = 0;
  let current = '';
  const tokens = expr.split(/\s+/u);
  for (const token of tokens) {
    for (const char of token) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
    }
    if (depth === 0 && token === operator) {
      parts.push(current.trim());
      current = '';
    } else {
      current += `${token} `;
    }
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== '');
}

function main() {
  const closure = resolveShippedClosure();
  const violations = [];
  const usedExceptions = new Set();

  for (const pkg of closure) {
    if (isSatisfiable(pkg.license)) {
      continue;
    }
    const exception = exceptions[pkg.name];
    if (exception && exception.license === pkg.license) {
      usedExceptions.add(pkg.name);
      continue;
    }
    violations.push(pkg);
  }

  const staleExceptions = Object.keys(exceptions).filter((name) => !usedExceptions.has(name));

  if (violations.length > 0) {
    console.error(`License policy: ${violations.length} disallowed package(s) in the shipped closure:\n`);
    for (const pkg of violations) {
      console.error(`  ✗ ${pkg.name}@${pkg.version} — ${pkg.license}`);
    }
    console.error(`\nEither add the SPDX id to "allowed" in .license-policy.json (if the policy permits it),`);
    console.error(`or add a reviewed per-package entry to "exceptions" with a reason.`);
    process.exit(1);
  }

  if (staleExceptions.length > 0) {
    console.error(`License policy: stale exception(s) no longer present in the closure — remove them:\n`);
    for (const name of staleExceptions) {
      console.error(`  ✗ ${name}`);
    }
    process.exit(1);
  }

  console.log(`License policy OK: ${closure.length} shipped packages, ${usedExceptions.size} reviewed exception(s).`);
}

main();
