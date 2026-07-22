---
description: Run the full validation gates and report each result explicitly.
argument-hint: '[none]'
---

Run all of photos' validation gates and report every result. When a gate fails,
surface the failure verbatim, fix it when in scope, rerun it, and continue
through the remaining gates. If a fix edits any tracked file, discard every
earlier gate result and restart the sequence at `npm run lint`; report success
only after one complete, edit-free pass through all gates.

## 1. Run the gates (in order)

```sh
npm run lint            # pins → new-file size → eslint → cycles → dead code → type coverage
npm run format:check
npm run check:a11y-budget  # a11y violation budget: shape, path existence, owned debt
npm run docs:gov        # documentation-governance gate (needs DOCS_GOV_TOOLING_ROOT; see AGENTS.md)
npm run test:cov        # typecheck + compile + unit tests under the c8 floor
npm run build
npm run test:e2e        # Playwright smoke + the composed-surface axe lane
npm run test:stories:ci # Storybook interaction tests + the per-story axe lane
```

## 2. Report

State, explicitly:

- ✅/❌ per gate (lint, format:check, check:a11y-budget, docs:gov, test:cov,
  build, test:e2e, test:stories:ci), with the failing output if any.
- Coverage totals vs. the `.c8rc.json` floors (`npm run coverage:summary`).
- The a11y violation budget total, and whether any surface came in **under**
  budget (which fails, and is fixed by tightening the entry — never by raising
  it).
- The `AGENTS.md` status footer (Working dir / Build / Commit), because `/check`
  is a validation run.

No product-invariant checks exist yet — when `AGENTS.md` → Product Invariants
gains entries backed by executable tests, call each out here by name.
