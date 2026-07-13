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
| 1   | Static        | `npm run lint` (pins → new-file size → eslint → cycles → dead code → type coverage), `typecheck`, `format:check` | Pins, size budgets, correctness (incl. react-hooks + @eslint-react for the renderer and the process-boundary import matrix), ts+tsx cycles, dead code, types (all four TS projects), style (ts/tsx/html included) | Active |
| 2   | Unit          | `npm test` — compile then `node --test` on `.test-dist/tests/**/*.test.js` | Pure logic, no DOM                                           | Active                              |
| 3   | Coverage      | `npm run test:cov` — c8 floors in `.c8rc.json` (**lines 90 / branches 80**) | Ratchet over the unit lane                                   | Active                              |
| 4   | DOM           | `test:dom` (happy-dom registrator, `tests/dom/`)             | Rendering/controllers against a real DOM                     | **Documented, not built** — add with the first UI code |
| 5   | Story         | `npm run test:stories:ci` — static Storybook build + test-runner (`play` assertions, chromium) | Component-level UI behavior on the real token canvas        | Active (#56 — token + Icon stories are the first content) |
| 6a  | E2E smoke     | `npm run test:e2e` — Playwright `_electron` launches the built app (`tests/e2e/smoke.spec.ts`) | The real Electron app launches, renders the React root, exposes only the typed bridge, IPC round-trips | Active (#52 — replaced the http-server fixture, which stayed green regardless of app health) |
| 6b  | Acceptance    | Playwright specs per canonical flow + a coverage-map ledger  | End-to-end user flows                                        | **Deferred** until user-facing surfaces exist |

### Compile-then-run model

Unit tests run against compiled JS: `tsconfig.test.json` emits unit-testable
sources (`src/shared/` + `tests/`, `jsx: react-jsx` ready for future `.tsx`)
to `.test-dist/`, then `node --test` runs the output — no loader magic.
**The unit runtime is Electron's own Node** (`ELECTRON_RUN_AS_NODE=1 electron
--test`, #72): native modules in `node_modules` carry the Electron ABI
(`postinstall` = `electron-builder install-app-deps`), so one ABI serves the
unit lane and the app — plain `node` cannot load the drivers. Electron's
major is capped by driver-prebuild availability (ADR-0006 prebuilt-only;
Dependabot ignore records the removal condition). E2E
builds the app once in `tests/e2e/global-setup.ts` (concurrent builds would
clobber each other's output).

### Electron multi-process gate coverage (#51)

The Electron layout (`src/main` / `src/preload` / `src/renderer` /
`src/shared`, ADR-0003) is fully inside the static gates: per-process strict
tsconfigs (`npm run typecheck` runs all four projects), type-aware ESLint with
react-hooks + `@eslint-react` on the renderer, `no-restricted-imports`
enforcing the process-boundary matrix (CLAUDE.md §Architecture), madge over
`ts,tsx`, knip via its electron-vite plugin, per-project `type-coverage`.

**Unit-lane c8 scope:** `src/shared/` (all pure logic) is floored; `src/main`,
`src/preload`, and the placeholder renderer component are excluded from the
unit-lane floor — they are Electron process wiring the unit lane cannot
execute, exercised instead by the E2E lane (Playwright-Electron from #52).
Floor values are unchanged (ratchet intact). Renderer components join the
floors via the DOM lane when the first real UI lands (M02); until then any
renderer logic beyond wiring belongs in `src/shared`.

### Playwright-Electron caveats (#52)

- `_electron` is marked **experimental** by Playwright — pin-bumps of
  `@playwright/test` (Dependabot) can move it; a red E2E lane after a
  Playwright bump should suspect the API first.
- Each test launches its own app instance from `out/` (hermetic, ~1s cost);
  global-setup builds once. `electron.launch({ args: ['.'] })` resolves the
  Electron binary from `node_modules` and the entry from `package.json#main`.
- On CI (ubuntu) Electron needs OS libraries (`npx playwright install-deps`)
  and a display server — the E2E step runs under `xvfb-run`. No browser
  download: Electron carries its own Chromium.
- The `webServer`/`baseURL` fixture mechanism is gone; there is no port to
  collide on, so parallel workers stay safe.

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
   `build` → Storybook interaction tests (`test:stories:ci`, chromium)
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

There is no scheduled/nightly run — all automation is PR-triggered, with one
manual exception:

### Packaging lane (manual, #53)

`npm run package` (electron-builder, unsigned: mac dmg+zip, win nsis) is
deliberately **not** in the PR gate — it is the slow lane. The **Package**
workflow (`workflow_dispatch`) builds unsigned mac + win artifacts on demand;
run it when packaging risk changes (Electron bumps, native modules, builder
config). electron-builder's `npmRebuild` stays on and native modules must land
in `dependencies` so the rebuild mechanism engages when better-sqlite3/sharp
arrive (M03, ADR-0006's prebuilt-only policy). Signing/notarization is M11.

### Perf baselines (manual, #74)

Recorded baselines live next to the lane that produces them; re-record when
the machinery they measure changes.

| Baseline | How | Result (2026-07-12, Apple Silicon dev machine) |
| --- | --- | --- |
| 200K keyset page | unit lane prints `[baseline] 200K keyset page` | 0.4 ms |
| 200K grid scroll | `npm run seed:perf` boots a 200,000-row synthetic profile; the grid's frame monitor exposes `globalThis.__overlookFrameStats` while scrolling | 557 frames observed, 0 dropped (>25 ms), worst 9.4 ms; 36 cells mounted |

The E2E lane keeps a fast 2,000-row variant of the same path
(`tests/e2e/grid.spec.ts`) so windowing + cursor paging stay covered per-PR;
the 200K run is manual because seeding takes ~17 s.

### Perf budgets (#123 — RATCHETS: tighten, never loosen)

The harness: `npm run test:perf` (own Playwright config, ~40 s once seeded;
never a per-PR gate) or the manual CI lane (`perf.yml`, `workflow_dispatch`).
It runs the 200K synthetic profile as a SETTLED library (synced ledger rows —
born-dirty scale rows poisoned pending counts and doomed backups; recorded),
measures the table below, writes `test-results/perf-report.json`, and asserts
the budgets in `tests/perf/budgets.ts` (the enforced copy of this table).
Cold start is measured on a RELAUNCH of the already-seeded profile — the
product case, not the one-time synthetic insert. Budgets carry ~2× headroom
over the recorded baseline so machine variance never flakes the lane; CI
numbers are indicative, the recorded baselines are the dev machine's.

| Metric | Budget | Baseline (2026-07-13, Apple Silicon dev machine, 200K) |
| --- | --- | --- |
| Cold start → existing-library grid interactive | < 5,000 ms | 1,643 ms |
| `library:page` (500) median over IPC | < 250 ms | 4 ms |
| `library:counts` median over IPC | < 1,000 ms | 689 ms |
| Search page median over IPC (place substring) | < 600 ms | 5 ms |
| Scroll dropped-frame share (zooms 96/160/320) | < 0.30 each | 0.20 / 0.00 / 0.00 |
| Scroll worst frame delta | < 500 ms | 68 ms |
| Import throughput (100 files, full pipeline) | > 3 photos/s | 34 photos/s |
| Main-process RSS after the workout | < 1,500 MB | ~280 MB |
| Renderer JS heap after the workout | < 512 MB | ~17 MB |

Known findings handed to #124: zoom-96 scroll drops (~0.20 — image-decode
churn at the densest tile size; target ratchet 0.10) and `counts()` at 689 ms
(five count queries; the offloaded/localOnly ledger subqueries dominate).

### Coverage-map distribution (#126 sweep, 2026-07-13)

The full design README screen/interaction inventory maps to 33 ledger
entries: **30 automated** (31 playwright-e2e, 12 storybook, 10 unit-dom
coverages), **1 manual-with-reason** (motion timings / hover fills /
disabled opacity — visual-only rules; the disabled PATTERN is exercised by
component stories), and **2 deferred-with-issues** for the design README's
"not yet designed" set: semantic search results UI (#224) and album
drag-and-drop reordering (#225). Zero unmapped flows; the validator
enforces shape, path existence, and that deferred entries carry issues.

## Policy: coverage travels with the change

1. **Prefer the cheapest lane that proves the behavior.** Unit for logic; DOM
   for rendering (once built); stories for component interaction (once built);
   Playwright only for true end-to-end flows.
2. **Regression fixes ship with a failing-then-passing test** at the lane that
   would have caught the bug.
3. **Never lower a floor to pass.** c8 thresholds, type-coverage, and the
   file-size budget are ratchets: raise them as coverage improves, never lower
   them to merge.
4. **The acceptance coverage-map ledger is ACTIVE** (#82, per
   [ADR-0001](ADR-0001-Automation-Check-Governance)): every user-facing flow
   declares its coverage in `tests/e2e/coverage-map.json` — automated
   (`playwright-e2e` / `storybook` / `unit-dom` with paths), `manual` (with a
   reason), or `deferred` (with an issue). Two gates enforce it inside
   `npm run ci` and the CI job (`npm run check:acceptance-coverage`):
   `check-e2e-coverage-map.mjs` validates shape, path existence, and that
   every Playwright spec is mapped (deleting a mapped spec fails);
   `check-acceptance-coverage-diff.mjs` requires renderer `.ts/.tsx/.css`
   changes to touch the map — or carry a `no-acceptance-impact` token in the
   PR body/label when a change genuinely has no flow impact. The PR template
   carries the acceptance checkbox; the coverage-summary reporter renders the
   map distribution on each run. Each epic seeds its own entries.

## Command quick reference

```sh
npm run ci              # full local gate (mirrors CI's non-browser jobs)
npm run test            # typecheck + compile + unit tests
npm run test:cov        # same under c8 with the coverage floor
npm run coverage:summary# render totals vs. floor
npm run test:e2e        # Playwright (builds app via global-setup)
npm run test:e2e:ui     # Playwright UI mode
```
