import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { budgetFor, evaluateSurface } from '../a11y/budget.js';
import type { BudgetEntry } from '../a11y/budget.js';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const entries: readonly BudgetEntry[] = [
  { id: 'budgeted-surface', story: 'x.stories.tsx', violations: 3, issues: [409], note: '3× color-contrast' },
];

describe('a11y violation budget verdicts (#398)', () => {
  // Acceptance scenario 2: "Seeding a deliberate violation in a story turns the axe gate
  // red." An unbudgeted surface is the case a newly-broken story actually hits — the
  // budget lists only known debt, so anything new is compared against an implicit zero.
  test('an unlisted surface is budgeted at zero, so a new violation fails', () => {
    const verdict = evaluateSurface({ id: 'brand-new-story', observed: 1, entries });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? '', /1 axe violation, budgeted 0/u);
    assert.match(verdict.reason ?? '', /does not rise/u);
  });

  test('a clean unlisted surface passes', () => {
    assert.deepEqual(evaluateSurface({ id: 'brand-new-story', observed: 0, entries }), { ok: true });
  });

  test('a budgeted surface at exactly its budget passes', () => {
    assert.deepEqual(evaluateSurface({ id: 'budgeted-surface', observed: 3, entries }), { ok: true });
  });

  test('a budgeted surface over its budget fails and names the owning issue', () => {
    const verdict = evaluateSurface({ id: 'budgeted-surface', observed: 4, entries });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? '', /4 axe violations, budgeted 3/u);
    assert.match(verdict.reason ?? '', /#409/u);
  });

  // The ratchet's other direction: an unrecorded improvement leaves a stale budget that
  // silently permits the surface to regress back up to it later.
  test('a budgeted surface under its budget fails, demanding the win be banked', () => {
    const verdict = evaluateSurface({ id: 'budgeted-surface', observed: 1, entries });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? '', /but the budget still says 3/u);
    assert.match(verdict.reason ?? '', /set violations to 1/u);
  });

  test('a fixed surface is told to delete its entry, not zero it', () => {
    const verdict = evaluateSurface({ id: 'budgeted-surface', observed: 0, entries });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? '', /delete the entry/u);
  });

  test('singular and plural violation counts both read correctly', () => {
    assert.match(evaluateSurface({ id: 'new', observed: 1, entries }).reason ?? '', /1 axe violation,/u);
    assert.match(evaluateSurface({ id: 'new', observed: 2, entries }).reason ?? '', /2 axe violations,/u);
  });

  test('budgetFor finds a listed entry and returns undefined otherwise', () => {
    assert.equal(budgetFor(entries, 'budgeted-surface')?.violations, 3);
    assert.equal(budgetFor(entries, 'nope'), undefined);
  });
});

describe('a11y budget file and gate wiring (#398)', () => {
  test('every budget entry names an owning issue and a real file', () => {
    const budget: unknown = JSON.parse(source('tests/a11y/violation-budget.json'));
    const { stories, flows } = budget as { stories: BudgetEntry[]; flows: BudgetEntry[] };

    assert.ok(stories.length > 0, 'the audited baseline is not empty');
    for (const entry of [...stories, ...flows]) {
      assert.ok(entry.violations > 0, `${entry.id}: zeroed entries are deleted, not kept`);
      assert.ok(entry.issues.length > 0, `${entry.id}: budgeted debt names an owner`);
      // The path the runtime lanes key off must exist, or the entry is permitting
      // violations on a surface that no longer renders.
      const path = entry.story ?? entry.spec;
      assert.ok(path !== undefined && path.length > 0, `${entry.id}: names its file`);
      assert.doesNotThrow(() => readFileSync(join(process.cwd(), path ?? '')), `${entry.id}: ${path ?? ''} exists`);
    }
  });

  test('the budget audits the full WCAG 2.2 AA tag set (#398)', () => {
    const budget = JSON.parse(source('tests/a11y/violation-budget.json')) as { tags: string[] };
    for (const tag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']) {
      assert.ok(budget.tags.includes(tag), `tag ${tag} is audited`);
    }
  });

  test('the check script refuses unowned, zeroed, and orphaned entries (#398)', () => {
    const script = source('scripts/check-a11y-budget.mjs');
    assert.match(script, /"issues" must list at least one issue number/u);
    assert.match(script, /"violations" must be a positive integer/u);
    assert.match(script, /which does not exist/u);
    assert.match(script, /duplicate entry/u);
    assert.match(script, /REQUIRED_TAGS/u);
  });

  test('both axe lanes are wired into the gates (#398)', () => {
    const packageJson = source('package.json');
    assert.match(packageJson, /"check:a11y-budget": "node scripts\/check-a11y-budget\.mjs"/u);
    // The static validator rides `npm run ci`; the runtime lanes ride the story and E2E jobs.
    assert.match(packageJson, /"ci": ".*check:a11y-budget.*"/u);
    assert.match(source('.storybook/test-runner.ts'), /getViolations/u);
    assert.match(source('tests/e2e/a11y.spec.ts'), /getViolations/u);
    assert.match(source('.github/workflows/ci.yml'), /check:a11y-budget/u);
  });
});
