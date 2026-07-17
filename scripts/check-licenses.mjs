#!/usr/bin/env node

// License-policy gate (#462): fail CI when a package in the shipped dependency
// closure carries a license that is neither on the allowlist nor covered by a
// reviewed exception. Keeps licensing compliance (#461) enforced instead of
// drifting.
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
const globalAllowed = new Set(policy.allowed);
const exceptions = Array.isArray(policy.exceptions) ? policy.exceptions : [];

// Match a package name against an exception's `packages` glob (exact, or a
// trailing `*` prefix wildcard — enough for the `@img/sharp-libvips-*` families).
function matchesGlob(pattern, name) {
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return pattern === name;
}

// Evaluate a (small) SPDX expression against an allowed set. Supports the shapes
// dependencies actually use: single ids, parenthesized groups, `OR` (any branch
// satisfies), `AND` (every operand must), `WITH` exception suffixes, and the
// synthetic `UNKNOWN` token for packages that declare no license.
function isSatisfiable(expression, allowed) {
  const expr = expression.trim();
  if (expr === '') {
    return false;
  }
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
      return isSatisfiable(expr.slice(1, -1), allowed);
    }
  }
  const or = splitTopLevel(expr, 'OR');
  if (or.length > 1) {
    return or.some((part) => isSatisfiable(part, allowed));
  }
  const and = splitTopLevel(expr, 'AND');
  if (and.length > 1) {
    return and.every((part) => isSatisfiable(part, allowed));
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
  for (const token of expr.split(/\s+/u)) {
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
    // An exception grants extra SPDX ids (or the UNKNOWN token) scoped to the
    // packages its glob matches; those augment the global allowlist for this
    // package only.
    const allowed = new Set(globalAllowed);
    for (let i = 0; i < exceptions.length; i += 1) {
      if (matchesGlob(exceptions[i].packages, pkg.name)) {
        usedExceptions.add(i);
        for (const id of exceptions[i].allow ?? []) {
          allowed.add(id);
        }
      }
    }
    if (!isSatisfiable(pkg.license, allowed)) {
      violations.push(pkg);
    }
  }

  const staleExceptions = exceptions.map((exception, index) => ({ exception, index })).filter(({ index }) => !usedExceptions.has(index));

  if (violations.length > 0) {
    console.error(`License policy: ${violations.length} disallowed package(s) in the shipped closure:\n`);
    for (const pkg of violations) {
      console.error(`  ✗ ${pkg.name}@${pkg.version} — ${pkg.license}`);
    }
    console.error(`\nEither add the SPDX id to "allowed" in .license-policy.json (if the policy permits it),`);
    console.error(`or add a reviewed "exceptions" entry ({ packages, allow, reason }).`);
    process.exit(1);
  }

  if (staleExceptions.length > 0) {
    console.error(`License policy: stale exception(s) that matched no shipped package — remove them:\n`);
    for (const { exception } of staleExceptions) {
      console.error(`  ✗ ${exception.packages}`);
    }
    process.exit(1);
  }

  console.log(`License policy OK: ${closure.length} shipped packages, ${usedExceptions.size} reviewed exception(s).`);
}

main();
