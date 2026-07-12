# Copilot Review Instructions

Review photos changes against the repo workflow and gate policies, not only
general TypeScript style. `AGENTS.md` is the shared agent-context file; the
full workflow lives in the wiki:
https://github.com/qwts/photos/wiki/Contributing

## Product Model

_None yet — the app has no product surface. As photos takes shape, the durable
data-model, storage, and privacy rules recorded in `AGENTS.md` → Product
Invariants become review priorities here._

## Review Priorities

- Flag dependency changes that are not exact pins, hand-edited version bumps
  (Dependabot owns upgrades), or `typescript` / `@types/node` moves off their
  pinned lines (TS 6.x; `@types/node` tracks `.nvmrc`'s Node 24).
- Flag lowered floors: `.c8rc.json` coverage thresholds, `type-coverage`
  `--at-least`, or the 800-line file budget must only ratchet upward.
- Flag files approaching or evading the 800-line budget (splitting is the fix,
  not exemptions).
- Flag broad rewrites, unrelated refactors, or formatting churn in narrow PRs.
- Prefer comments that identify user-visible bugs, state corruption, missing
  tests, or gate/CI weakening.

## GitHub And Branch Workflow

- Development is trunk-based on `main`: short-lived branches, merged via PR.
- Tracked work links the PR to its issue with an explicit closing reference
  (`Closes #N`) — the close-linked-issues workflow parses merged PR bodies.
- When a PR changes behavior, testing strategy, CI, automation, or workflow
  expectations, expect a matching wiki/ADR/AGENTS.md update in the same PR.

## Expected Validation

Before a PR is called ready, expect these checks unless the PR clearly explains
why one could not run:

- `npm run ci` (lint chain, format check, tests + coverage floor, build)
- `npm run test:e2e` for E2E-relevant changes
