---
description: Run the full validation gates and report each result explicitly.
argument-hint: '[none]'
---

Run all of photos' validation gates and report every result. When a gate fails,
surface the failure verbatim, fix it when in scope, rerun it, and continue
through the remaining gates. If a fix edits any tracked file, discard every
earlier gate result and restart the sequence at `npm run lint`; report success
only after one complete, edit-free pass through all five gates.

## 1. Run the gates (in order)

```sh
npm run lint          # pins → new-file size → eslint → cycles → dead code → type coverage
npm run format:check
npm run test:cov      # typecheck + compile + unit tests under the c8 floor
npm run build
npm run test:e2e      # Playwright smoke (builds the app via global-setup)
```

## 2. Report

State, explicitly:

- ✅/❌ per gate (lint, format:check, test:cov, build, test:e2e), with the
  failing output if any.
- Coverage totals vs. the `.c8rc.json` floors (`npm run coverage:summary`).
- The `AGENTS.md` status footer (Working dir / Build / Commit), because `/check`
  is a validation run.

No product-invariant checks exist yet — when `AGENTS.md` → Product Invariants
gains entries backed by executable tests, call each out here by name.
