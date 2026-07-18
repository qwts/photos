# Agent process-tree memory guard

Ported from Image Trail (qwts/image-trail), which added this after a
memory-runaway incident: a happy-dom `node:test` run grew ~2 GB/s, macOS
attributed ~89 GB to the launcher coalition, and the machine was force-reset
twice. Photos runs the same class of test — Electron-hosted `node:test`
(`test:unit:run`), a happy-dom DOM suite (`test:dom:run`), Playwright-driven
Electron E2E, and a 200K-photo perf harness that seeds a large synthetic
library — so this guard is adopted proactively here before this repo has its
own incident.

This doc is referenced directly by `AGENTS.md` for agent operational safety;
like `AGENTS.md` itself, it is kept in-repo rather than the wiki so the
guarded entrypoints and their limits are versioned alongside the scripts they
describe.

## The guard: `scripts/run-guarded.mjs`

Wraps a command in its own process group (`spawn` with `detached: true`) and
polls `ps -axo pid,ppid,pgid,rss` every 250 ms. Enforced, per run:

| Control               | Default                                                                                   | Override                                   |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| Aggregate RSS ceiling | 4096 MB (8192 MB for e2e lanes, 12288 MB for stories:ci and the perf lane)                | `OVERLOOK_GUARD_RSS_MB` / `--rss-mb`       |
| Per-process V8 heap   | 2048 MB (`--max-old-space-size`)                                                          | `OVERLOOK_GUARD_HEAP_MB` / `--heap-mb`     |
| Wall-clock timeout    | 900 s (1200 s stories, 1800 s stories:ci/e2e, 2700 s perf, 0 = off for `--ui`/`--headed`) | `OVERLOOK_GUARD_TIMEOUT_S` / `--timeout-s` |
| Concurrency           | one guarded run per worktree                                                              | `.guard/active.json` lock (stale-safe)     |

Environment variables override the per-script flags, so CI or a human can tune
limits without editing `package.json`. The aggregate-RSS sum counts every
descendant of the wrapped command plus anything still in its process group
(catching orphans that reparent to `launchd`/`init`), so Electron, Chromium,
and helper binaries count — not just V8 heaps.

Termination is graceful-then-forced: `SIGTERM` to the whole group on breach,
`SIGKILL` after 2 s — or immediately if RSS passes 1.25x the ceiling, because a
runaway allocating gigabytes per second outruns a polite shutdown.
`SIGINT`/`SIGTERM`/`SIGHUP` to the guard (Ctrl-C, client exit, task
cancellation) forward the same group termination, and a final `SIGKILL` sweep
runs when the wrapped command exits, so no descendants survive the guard.

Every run writes a diagnostic record — label, command, peak RSS, peak process
count, duration, limits, exit code, termination reason — to
`.guard/last-run.json` and appends it to `.guard/history.jsonl` (both
gitignored). A run killed for `rss-limit` or `timeout` exits non-zero, so a
test that "passes" while eating tens of gigabytes is a failed test, locally
and in CI.

Nested guards pass through (`OVERLOOK_GUARDED=1` in the child environment), so
chained npm scripts do not deadlock on the worktree lock.
`OVERLOOK_GUARD_DISABLE=1` is a human escape hatch; it prints a warning.
Windows falls back to passthrough (the guard targets macOS/Linux `ps`).

## Guarded entrypoints

`npm test`, `test:dom`, `test:cov`, `test:stories`, `test:stories:ci`,
`test:e2e`, `test:e2e:visible`, `test:e2e:ui`, `test:e2e:headed`, and
`test:perf` all invoke the guard, which runs the matching `*:inner` script.
The `*:run` / `*:inner` scripts are implementation details — never call them
directly.

`test:pcloud:live` and `test:google-drive:live` are opt-in, live-credential
contract tests that are not part of the routine local/CI/agent loop; they are
unguarded today (see Bypass cases below).

## Enforcement by environment

### Claude Code

`.claude/settings.json` registers a `PreToolUse` hook on `Bash`
(`scripts/guard-agent-command.mjs --protocol=claude`) that denies direct
`electron --test`, `node --test`, `.test-dist`/`.test-dist-dom` execution,
`playwright test`, `test-storybook`, `c8`, and `:run`/`:inner` scripts,
steering the agent to the guarded entrypoints. Applies to terminal, IDE
integration, and headless runs alike because project settings are checked in.
Background-shell etiquette (poll or terminate a live command before starting
another) is enforced mechanically by the worktree lock: a second guarded run
refuses to start while one is active.

### Cursor

`.cursor/hooks.json` (`beforeShellExecution`, same script with
`--protocol=cursor`) blocks agent-issued unguarded commands;
`.cursor/rules/process-guard.mdc` (`alwaysApply`) carries the written rule.
The worktree lock prevents overlapping agent retries. Hooks are a recent
Cursor feature — if a Cursor version does not honor them, the npm scripts
themselves are still guarded; only the direct-binary bypass reopens.

### Codex

Codex exposes no project-scoped command hook or child-process RSS/coalition
limit, so the enforcement point IS the npm scripts: any `npm test`-family
command Codex runs is guarded. `AGENTS.md` carries the written rules
(secondary control): use guarded entrypoints only; when an execution returns a
live session/cell ID, poll or terminate it before launching anything else —
the worktree lock also refuses a second run mechanically.

### CI (`.github/workflows/ci.yml`, `.github/workflows/perf.yml`)

CI runs the same npm scripts, so every test step inherits the guard and its
RSS/timeout budgets; job-level `timeout-minutes` is the outer backstop. A
memory-runaway or hung suite now fails the build instead of passing on a
GitHub-hosted runner. Both the `CI` job's Test step and the `E2E` and
`Perf harness` jobs print `.guard/last-run.json` after the run (even on
failure) so ceilings can be ratcheted from measured peaks.

## Bypass cases (accepted, documented)

- A human (or agent whose environment lacks hooks — e.g. Codex) running raw
  `electron --test` / `npx playwright test` in a terminal. Mitigation: guarded
  scripts are the paved road; `AGENTS.md` forbids the raw forms.
- `test:pcloud:live` / `test:google-drive:live` — opt-in, credential-gated
  contract tests run manually by a human with real provider credentials, not
  part of the agent test loop. Unguarded today; wrap with a `--label` guard
  invocation if they ever misbehave.
- `OVERLOOK_GUARD_DISABLE=1` — intentional, warns loudly.
- Non-test entrypoints (`npm run build`, `npm run dev`, `npm run storybook`
  dev server, `npm run seed:dev`, `npm run seed:perf`) are unguarded today;
  extend with a `--label` wrapper if they ever misbehave.
- The Claude/Cursor hooks fail open on malformed payloads by design — the
  wrapper, not the hook, is the primary control.

## Safe validation procedure

Never validate with the real test suites unguarded. Use a synthetic allocator:

```sh
OVERLOOK_GUARD_RSS_MB=300 node scripts/run-guarded.mjs --label selftest -- \
  node -e 'const a=[];setInterval(()=>a.push(Buffer.alloc(64<<20,1)),50)'
```

Expected: the guard reports `rss-limit`, the group dies (TERM->KILL), the run
exits 1, and `.guard/last-run.json` records the reason and peak RSS. Timeout
path: same command with `OVERLOOK_GUARD_TIMEOUT_S=5`. Lock path: start a
guarded run, then a second in the same worktree — it must refuse.

## Baselines (measured locally, Apple Silicon, Node 24.18)

See `.guard/history.jsonl` in a working checkout for current numbers; ratchet
ceilings from measured peaks with headroom, not guesses:

- Full `npm test` (typecheck + compile + Electron-hosted unit + happy-dom DOM):
  peak 1845-2071 MB across 19 processes over three runs → 4096 MB default
  (~2x headroom).
- `npm run test:cov` (same, under `c8`): peak 1932 MB across 20 processes,
  comparable to `npm test` plus c8's own overhead → 4096 MB default.
- `npm run test:stories:ci` (static Storybook build served over http, driven
  by Playwright chromium): the 4096 MB default killed a **healthy** run 18 s
  in, mid-build (`rss-limit`, 44 processes) — the esbuild/webpack build step is
  the heavy part, not the interaction tests themselves. An 8192 MB trial
  ceiling let it complete but peaked at 8067 MB, only ~1.5% headroom. A second
  run at the same 8192 MB ceiling would plausibly have been killed by normal
  run-to-run variance (a third measurement at a raised ceiling came in at only
  5660 MB, a >2x spread across runs) — raised to 12288 MB (~1.5-2x headroom
  over both observed peaks), the same ceiling as the perf lane and the same
  ratchet-up-after-a-healthy-kill pattern image-trail's own e2e ceiling went
  through.
- `npm run test:e2e` (Playwright driving real Electron instances, `workers: 3`
  on CI) and `npm run test:perf` (single worker, 200K-photo synthetic seed):
  **provisional.** The 8192 MB / 12288 MB ceilings above are generous trial
  values, not measured peaks — both lanes need a real Electron window and a
  display server (Xvfb in CI), so they were not run against the guard
  locally to avoid popping up GUI windows on this machine. Tighten (or, if
  the guard kills a healthy run — as happened locally with the stories:ci
  ceiling above — raise) both from the first real CI run's
  `.guard/last-run.json`, the same way image-trail's own e2e ceiling was
  raised from a too-tight trial value after its first full run.

## Limitations

- Polling at 250 ms with a fast-enough runaway can overshoot the ceiling
  briefly before SIGTERM lands; the 1.25x hard-kill bounds the tail. There is
  no unprivileged macOS API for a hard aggregate-RSS cap on a process tree
  (`ulimit -v` is ineffective on modern macOS; jetsam limits and
  `ledger`/coalition caps are not settable for user processes). CI runs on
  Linux, where `ps -axo pid,ppid,pgid,rss` is also available and the guard
  behaves the same way; a container-level cgroup memory cap is a stronger,
  future escalation tier there if the guard's soft polling proves
  insufficient.
- The guard cannot govern processes an agent starts completely outside the
  repo scripts and hooks.
