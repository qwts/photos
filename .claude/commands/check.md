---
description: Run the full validation gates and report each result explicitly.
argument-hint: '[none]'
---

Run photos' validation gates, then report the result. Do not skip a step; if a
gate fails, stop and surface the failure verbatim.

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
- The `AGENTS.md` status footer (Working dir / Build / Commit).

No product-invariant checks exist yet — when `AGENTS.md` → Product Invariants
gains entries backed by executable tests, call each out here by name.
