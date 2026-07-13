# M11: Scale, hardening & release readiness

**Epic:** [#46](https://github.com/qwts/photos/issues/46) · **Lane:** Closing

The closing epic: prove the 200K-photo target with a perf harness and budgets, audit crash-safety (interrupted import/backup, orphan repair), sweep the acceptance-coverage-map to completeness, replace gradient placeholder fixtures with real sample images, security-review the crypto/IPC surfaces, and stand up signed/notarized packaging (**blocked on user-supplied signing certs** — flagged on its issue).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#123](https://github.com/qwts/photos/issues/123) | 200K-library performance harness + budgets | #72, #74 |
| [#124](https://github.com/qwts/photos/issues/124) | Grid/thumbnail performance tuning to budget | #123 |
| [#125](https://github.com/qwts/photos/issues/125) | Crash-safety audit: kill-tests for import/backup, orphan repair | #87, #105 |
| [#126](https://github.com/qwts/photos/issues/126) | Acceptance-coverage-map completeness sweep | #90, #96, #101, #110, #116, #122 |
| [#127](https://github.com/qwts/photos/issues/127) | Real sample-image fixtures replace gradient placeholders | #72 |
| [#128](https://github.com/qwts/photos/issues/128) | Signed & notarized packaging (needs certificates) | #53 |
| [#129](https://github.com/qwts/photos/issues/129) | Security review: crypto and IPC surfaces | #107 |

## Acceptance coverage

| Area | Status | Coverage |
| --- | --- | --- |
| 200K-library perf harness + budgets: `npm run test:perf` (`playwright.perf.config.ts`, `tests/perf/`), manual CI lane `perf.yml`, ratchet budgets in `tests/perf/budgets.ts`. Cold start = timed relaunch of a pre-seeded profile (seed flag only on the untimed seeding launch); synthetic seed settles the ledger (born-dirty scale rows had poisoned pending counts — import fell 88×, heap 1.4 GB — and doomed backups) | ✅ #123 (PR #221) | `tests/perf/perf-harness.spec.ts` + wiki [Testing Strategy](Testing-Strategy) §Perf budgets |
| Grid/thumbnail tuning to budget: `counts()` single-pass FILTER (689→378 ms, ratchet tightened to 500); the zoom-96 disk-cache lever was **rejected on privacy grounds** (plaintext thumbs must never hit Chromium's disk cache) | ✅ #124 (PR #228) | perf budgets + `tests/db/photos-repository` property suite (count === page-walk) |
| Crash-safety audit: `ConsistencyChecker` scan/repair (orphan blobs/thumbs, **age-gated** staging leftovers, lying rows → remote-verified `offloaded` else `error`); `SyncLedger.repairStatus` escape hatch; a lightweight repair at library open. Age gate protects live seed/import writes from the startup sweep | ✅ #125 (PR #223) | `tests/library/consistency.test.ts` (crash-window matrix + corrupted-store-repairs proof) — ledger ids `m11-consistency-*` |
| Acceptance-coverage-map completeness sweep: 33 mapped entries, 2 deferred (#224 semantic search, #225 album reorder), 1 manual with reason; distribution documented | ✅ #126 (PR #226) | `tests/e2e/coverage-map.json` + `npm run check:acceptance-coverage` |
| Real sample-image fixtures replace gradient placeholders | ⛔ #127 — **blocked on owner** (licensed photos or download approval); flagged on the issue | — |
| Signed & notarized packaging | ⛔ #128 — **blocked on owner** (signing certificates); flagged on the issue | — |
| Security review of the crypto/IPC surfaces: adversarial audit of the AES-256-GCM envelope + keystore, the IPC registry + custom protocol handlers, and a plaintext-at-rest sweep. All three seams sound; zero fix-before-release findings. Fix F1: harness env hooks gated on `!app.isPackaged` (packaged app not env-steerable). Follow-ups #229/#230/#231 filed | ✅ #129 (PR #232) | `tests/import/import-service.test.ts` (env-gate) + [Security Review M11](Security-Review-M11) + [ADR-0004](ADR-0004-Encryption-And-Key-Management#accepted-deviations--review-notes) appendix |

The two ⛔ rows are the epic's only open work and are **owner-blocked** (they need user-supplied assets/credentials, not engineering); they stay open on the epic per the milestone note. Everything shippable in M11 is delivered and green through `ci` + e2e + Storybook + perf gates.

## Definition of done

See the epic issue [#46](https://github.com/qwts/photos/issues/46) — the epic body is canonical; this page is the planning index entry.
