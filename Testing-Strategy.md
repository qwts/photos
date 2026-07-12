# Testing Strategy

> Canonical reference for how photos is tested: the lanes, what runs when and
> where, and the policy for adding coverage when features land. Lives in the
> wiki (wiki-first); the repo keeps only pointers.

## TL;DR

- **Local "before done" gate:** `npm run ci` = lint suite + `format:check` +
  `test:cov` + `build` — the same non-browser gates CI runs.
- **CI runs everything** on every PR to `main` and every push to `main`,
  including the coverage floor and the Playwright E2E lane (path-filtered).
- **Floors ratchet upward only:** c8 lines 90 / branches 80 (`.c8rc.json`),
  type-coverage 99.8 strict, file-size budget 800 lines.
- **Policy:** coverage travels with the change — a new or changed user-facing
  flow lands with tests at the cheapest lane that proves the behavior.

## The lanes

| #   | Lane          | Command                                | Scope                                                        | Status                              |
| --- | ------------- | -------------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| 1   | Static        | `npm run lint` (pins → new-file size → eslint → cycles → dead code → type coverage), `typecheck`, `format:check` | Pins, size budgets, correctness, cycles, dead code, types, style | Active |
| 2   | Unit          | `npm test` — compile then `node --test` on `.test-dist/tests/**/*.test.js` | Pure logic, no DOM                                           | Active                              |
| 3   | Coverage      | `npm run test:cov` — c8 floors in `.c8rc.json` (**lines 90 / branches 80**) | Ratchet over the unit lane                                   | Active                              |
| 4   | DOM           | `test:dom` (happy-dom registrator, `tests/dom/`)             | Rendering/controllers against a real DOM                     | **Documented, not built** — add with the first UI code |
| 5   | Story         | Storybook `play` interaction tests                           | Component-level UI behavior                                  | **Deferred** — issue #11, blocked on UI code |
| 6a  | E2E smoke     | `npm run test:e2e` — `tests/e2e/smoke.spec.ts`               | The served surface loads and renders                         | Active (fixture page until the app has a real surface) |
| 6b  | Acceptance    | Playwright specs per canonical flow + a coverage-map ledger  | End-to-end user flows                                        | **Deferred** until user-facing surfaces exist |

### Compile-then-run model

Unit tests run against compiled JS: `tsconfig.test.json` emits `src/` +
`tests/` to `.test-dist/`, then `node --test` runs the output — no loader
magic. E2E builds the app once in `tests/e2e/global-setup.ts` (concurrent
builds would clobber each other's `dist/`).

## What runs when & where

### Local — the "before done" gate

```sh
npm run ci        # lint suite, format:check, test:cov, build
npm run test:e2e  # additionally, for E2E-relevant changes
```

The pre-commit hook (husky + lint-staged) auto-fixes staged files
(`eslint --fix` + prettier) but runs no tests — CI owns the full gate.

### CI — `.github/workflows/ci.yml`

On every PR to `main` and push to `main` (post-merge signal):

1. `lint` (full chain) → `format:check` → `test:cov` (with
   `node-test-github-reporter` annotations) → coverage summary + lcov artifact →
   `build`
2. **E2E job** (parallel, own runner): path-filtered by `dorny/paths-filter` —
   docs-only PRs skip it; always runs on main pushes. Chromium via Playwright,
   `test:e2e`, HTML report artifact (14-day retention).
3. **`E2E gate`** — the stable required check: green on E2E success or a
   legitimate filter skip; red if change detection itself failed. The branch
   ruleset requires **this job**, never `E2E` directly.
4. **`e2e-report`** — on E2E failure only: publishes the HTML report (traces,
   screenshots, videos) to Pages at a stable per-PR URL,
   `https://qwts.github.io/photos/reports/pr-<number>/`, with freshness check,
   serialized gh-pages pushes, and a Pages verify/self-heal step.

There is no scheduled/nightly run — all automation is PR-triggered.

## Policy: coverage travels with the change

1. **Prefer the cheapest lane that proves the behavior.** Unit for logic; DOM
   for rendering (once built); stories for component interaction (once built);
   Playwright only for true end-to-end flows.
2. **Regression fixes ship with a failing-then-passing test** at the lane that
   would have caught the bug.
3. **Never lower a floor to pass.** c8 thresholds, type-coverage, and the
   file-size budget are ratchets: raise them as coverage improves, never lower
   them to merge.
4. When user-facing surfaces exist, adopt image-trail's **coverage-map ledger**
   (acceptance flows each declare automated / manual-with-reason /
   deferred-with-issue coverage) — tracked as a future issue; see
   [ADR-0001](ADR-0001-Automation-Check-Governance).

## Command quick reference

```sh
npm run ci              # full local gate (mirrors CI's non-browser jobs)
npm run test            # typecheck + compile + unit tests
npm run test:cov        # same under c8 with the coverage floor
npm run coverage:summary# render totals vs. floor
npm run test:e2e        # Playwright (builds app via global-setup)
npm run test:e2e:ui     # Playwright UI mode
```
