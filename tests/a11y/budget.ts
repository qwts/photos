// The a11y violation budget's decision logic (#398), shared by the two lanes that
// enforce it: .storybook/test-runner.ts (per story) and tests/e2e/a11y.spec.ts (per
// composed flow). The budget itself is tests/a11y/violation-budget.json — see its
// $comment for the policy. Kept as one module so the two lanes cannot drift into
// disagreeing about what "over budget" means.

// Rule id -> how many violations of that rule the surface is allowed. Keyed by rule
// rather than totalled, because a total is not a ratchet: a surface budgeted at
// 1× color-contrast could be "fixed" into 1× button-name and still sum to 1, letting a
// brand-new regression hide behind existing debt (PR #408 review).
export type RuleCounts = Readonly<Record<string, number>>;

export interface BudgetEntry {
  readonly id: string;
  readonly story?: string;
  readonly spec?: string;
  readonly rules: RuleCounts;
  // Plural: one surface routinely fails several rules at once, and those rules belong to
  // different children of the epic. Naming every owner keeps a failure actionable — the
  // reader learns which issue to go read, not just that debt exists.
  readonly issues: readonly number[];
}

export interface ViolationBudget {
  readonly tags: readonly string[];
  readonly stories: readonly BudgetEntry[];
  readonly flows: readonly BudgetEntry[];
}

export interface BudgetVerdict {
  readonly ok: boolean;
  readonly reason?: string;
}

export function totalViolations(rules: RuleCounts): number {
  return Object.values(rules).reduce((sum, count) => sum + count, 0);
}

// A surface with no entry is budgeted at zero on every rule: new surfaces start clean,
// and debt has to be written down to be allowed. Returning the entry (not just the
// counts) keeps the owning issues available for the failure message.
export function budgetFor(entries: readonly BudgetEntry[], id: string): BudgetEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

function describe(rule: string, count: number): string {
  return `${count}× ${rule}`;
}

export function evaluateSurface({
  id,
  observed,
  entries,
}: {
  id: string;
  observed: RuleCounts;
  entries: readonly BudgetEntry[];
}): BudgetVerdict {
  const entry = budgetFor(entries, id);
  const budgeted = entry?.rules ?? {};
  const owner = entry === undefined || entry.issues.length === 0 ? '' : ` Owned by ${entry.issues.map((issue) => `#${issue}`).join(', ')}.`;

  const rules = [...new Set([...Object.keys(budgeted), ...Object.keys(observed)])].sort();
  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const rule of rules) {
    const allowed = budgeted[rule] ?? 0;
    const found = observed[rule] ?? 0;
    if (found > allowed) regressions.push(`${describe(rule, found)} (budgeted ${allowed})`);
    else if (found < allowed) improvements.push(`${describe(rule, found)} (budgeted ${allowed})`);
  }

  // Regressions win the message: a surface can improve on one rule and regress on another
  // in the same change, and the regression is the part that must not merge.
  if (regressions.length > 0) {
    return {
      ok: false,
      reason: `${id}: axe violations above budget — ${regressions.join(', ')}.${owner} Fix them; the budget is a ratchet and does not rise.`,
    };
  }

  // Under budget is also a failure: an unrecorded improvement leaves a stale number that
  // silently permits the surface to regress back up to it. Banking the win is the point.
  if (improvements.length > 0) {
    const remaining: RuleCounts = Object.fromEntries(Object.entries(observed).filter(([, count]) => count > 0));
    const target = totalViolations(remaining) === 0 ? 'delete the entry' : `set "rules" to ${JSON.stringify(remaining)}`;
    return {
      ok: false,
      reason: `${id}: now below budget — ${improvements.join(', ')}. Tighten it in tests/a11y/violation-budget.json (${target}).`,
    };
  }

  return { ok: true };
}

// Closure over the budget: every entry must correspond to a surface the lane actually
// visited. Without this, renaming a story export or deleting a flow leaves its entry
// behind — the runtime lane stops evaluating that id, the file it names still exists, and
// the stale row quietly overstates what the budget covers (PR #408 review).
export function findOrphanedEntries({
  entries,
  visited,
}: {
  entries: readonly BudgetEntry[];
  visited: ReadonlySet<string>;
}): readonly string[] {
  return entries.filter((entry) => !visited.has(entry.id)).map((entry) => entry.id);
}
