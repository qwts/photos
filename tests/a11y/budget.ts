// The a11y violation budget's decision logic (#398), shared by the two lanes that
// enforce it: .storybook/test-runner.ts (per story) and tests/e2e/a11y.spec.ts (per
// composed flow). The budget itself is tests/a11y/violation-budget.json — see its
// $comment for the policy. Kept as one module so the two lanes cannot drift into
// disagreeing about what "over budget" means.

export interface BudgetEntry {
  readonly id: string;
  readonly story?: string;
  readonly spec?: string;
  readonly violations: number;
  // Plural: one surface routinely fails several rules at once, and those rules belong to
  // different children of the epic. Naming every owner keeps a failure actionable — the
  // reader learns which issue to go read, not just that debt exists.
  readonly issues: readonly number[];
  readonly note: string;
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

// A surface with no entry is budgeted at zero: new surfaces start clean, and debt has
// to be written down to be allowed. Returning the entry (not just the number) keeps the
// owning issue available for the failure message.
export function budgetFor(entries: readonly BudgetEntry[], id: string): BudgetEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

export function evaluateSurface({
  id,
  observed,
  entries,
}: {
  id: string;
  observed: number;
  entries: readonly BudgetEntry[];
}): BudgetVerdict {
  const entry = budgetFor(entries, id);
  const budgeted = entry?.violations ?? 0;

  if (observed > budgeted) {
    const owner = entry ? ` The budget of ${budgeted} is owned by ${entry.issues.map((issue) => `#${issue}`).join(', ')}.` : '';
    return {
      ok: false,
      reason:
        `${id}: ${observed} axe violation${observed === 1 ? '' : 's'}, budgeted ${budgeted}.` +
        `${owner} Fix the violation — the budget is a ratchet and does not rise.`,
    };
  }

  // Under budget is also a failure: an unrecorded improvement lets the surface silently
  // regress back up to the stale number later. Banking the win is the ratchet's whole point.
  if (observed < budgeted) {
    return {
      ok: false,
      reason:
        `${id}: ${observed} axe violation${observed === 1 ? '' : 's'}, but the budget still says ${budgeted}. ` +
        `Tighten it in tests/a11y/violation-budget.json${observed === 0 ? ' (delete the entry)' : ` (set violations to ${observed})`}.`,
    };
  }

  return { ok: true };
}
