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
