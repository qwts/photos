import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { injectAxe, getViolations } from 'axe-playwright';

import { evaluateSurface, findOrphanedEntries } from '../a11y/budget.js';
import type { RuleCounts, ViolationBudget } from '../a11y/budget.js';

// The composed-surface half of the a11y gate (#398). The story lane
// (.storybook/test-runner.ts) audits every story, but it mounts each component in
// ISOLATION — so it structurally cannot see the failures that only exist once the real app
// composes them: duplicate/missing landmarks, focus order across regions, an overlay that
// leaves the shell behind it in the a11y tree, live regions colliding.
//
// These flows are the composed surfaces that the audit ranked highest-risk. Both lanes
// share tests/a11y/budget.ts so "over budget" means the same thing in each.
const budget = JSON.parse(readFileSync(join(process.cwd(), 'tests/a11y/violation-budget.json'), 'utf8')) as ViolationBudget;

// Flows this run actually audited. playwright.config.ts sets fullyParallel: false, so the
// tests in this file run serially in one worker — the closure test at the bottom therefore
// sees every id the ones above recorded.
const visitedFlows = new Set<string>();

async function launchSeeded(slug: string, seed: string): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), `overlook-e2e-a11y-${slug}-`));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: seed,
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  const page = await app.firstWindow();
  await page.getByTestId('virtual-grid').waitFor();
  // A REAL tile, not a placeholder cell — the #189 cold-start race. Auditing before the
  // first page lands would measure an empty grid and bank a meaningless zero.
  await page.locator('.ovl-tile__img').first().waitFor();
  await injectAxe(page);
  return { app, page };
}

function countByRule(violations: readonly { id: string }[]): RuleCounts {
  const counts: Record<string, number> = {};
  for (const violation of violations) counts[violation.id] = (counts[violation.id] ?? 0) + 1;
  return counts;
}

async function assertWithinBudget(page: Page, id: string): Promise<void> {
  visitedFlows.add(id);
  // getViolations takes axe's RunOptions DIRECTLY as its third argument — not the
  // {axeOptions} wrapper that checkA11y takes. Passing the wrapper type-checks as a
  // loose object but is silently ignored at runtime, which audits against axe's full
  // default rule set (best-practice rules included) instead of the WCAG 2.2 AA tags.
  const violations = await getViolations(page, undefined, { runOnly: { type: 'tag', values: [...budget.tags] } });
  const verdict = evaluateSurface({ id, observed: countByRule(violations), entries: budget.flows });
  const detail = violations.map((violation) => `  - [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}`).join('\n');
  expect(verdict.ok, `${verdict.reason ?? ''}\n${detail}`).toBe(true);
}

test('a11y: the composed shell — sidebar, toolbar, grid, and status bar together', async () => {
  const { app, page } = await launchSeeded('shell', '12');
  try {
    await assertWithinBudget(page, 'shell-grid');
  } finally {
    await app.close();
  }
});

test('a11y: the lightbox over the shell', async () => {
  const { app, page } = await launchSeeded('lightbox', '4');
  try {
    await page.locator('.ovl-grid__cell').first().click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await assertWithinBudget(page, 'shell-lightbox');
  } finally {
    await app.close();
  }
});

test('a11y: the inspector rail open beside the grid', async () => {
  const { app, page } = await launchSeeded('inspector', '12');
  try {
    await page.locator('.ovl-grid__cell').first().click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
    await assertWithinBudget(page, 'shell-inspector');
  } finally {
    await app.close();
  }
});

test('a11y: a modal dialog stacked over the shell', async () => {
  const { app, page } = await launchSeeded('dialog', '12');
  try {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertWithinBudget(page, 'shell-settings-dialog');
  } finally {
    await app.close();
  }
});

test('a11y: a selection active in the grid', async () => {
  const { app, page } = await launchSeeded('selection', '12');
  try {
    await page.locator('.ovl-tile__select').first().click();
    await expect(page.getByTestId('selection-pill')).toBeVisible();
    await assertWithinBudget(page, 'shell-selection');
  } finally {
    await app.close();
  }
});

// Declared last on purpose: it asserts over what the tests above recorded. Renaming or
// deleting a flow without touching its budget row would otherwise leave debt behind that
// nothing evaluates — the row's `spec` file still exists, so the static check cannot see
// it either (PR #408 review). Skipped under --grep, where a partial run is expected.
test('a11y: every budgeted flow was actually audited', () => {
  test.skip(visitedFlows.size < 5, 'partial run (--grep); closure only holds for the full file');
  const orphans = findOrphanedEntries({ entries: budget.flows, visited: visitedFlows });
  expect(orphans, `Budgeted flows that no test audits: ${orphans.join(', ')}. Delete the entry or restore the flow.`).toEqual([]);
});
