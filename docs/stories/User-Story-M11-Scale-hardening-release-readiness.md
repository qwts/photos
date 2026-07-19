# M11: Scale, hardening & release readiness

**Epic:** [#46](https://github.com/qwts/photos/issues/46) · **Lane:** Closing

The closing epic: prove the 200K-photo target with a perf harness and budgets, audit crash-safety (interrupted import/backup, orphan repair), sweep the acceptance-coverage-map to completeness, replace gradient placeholder fixtures with real sample images, security-review the crypto/IPC surfaces, and stand up signed/notarized packaging.

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
| 200K-library perf harness + budgets: `npm run test:perf` (`playwright.perf.config.ts`, `tests/perf/`), manual CI lane `perf.yml`, ratchet budgets in `tests/perf/budgets.ts`. Cold start = timed relaunch of a pre-seeded profile (seed flag only on the untimed seeding launch); synthetic seed settles the ledger (born-dirty scale rows had poisoned pending counts — import fell 88×, heap 1.4 GB — and doomed backups) | ✅ #123 (PR #221) | `tests/perf/perf-harness.spec.ts` + wiki [Testing Strategy](../Testing-Strategy.md) §Perf budgets |
| Grid/thumbnail tuning to budget: `counts()` single-pass FILTER (689→378 ms, ratchet tightened to 500); the zoom-96 disk-cache lever was **rejected on privacy grounds** (plaintext thumbs must never hit Chromium's disk cache) | ✅ #124 (PR #228) | perf budgets + `tests/db/photos-repository` property suite (count === page-walk) |
| Crash-safety audit: `ConsistencyChecker` scan/repair (orphan blobs/thumbs, **age-gated** staging leftovers, lying rows → remote-verified `offloaded` else `error`); `SyncLedger.repairStatus` escape hatch; a lightweight repair at library open. Age gate protects live seed/import writes from the startup sweep | ✅ #125 (PR #223) | `tests/library/consistency.test.ts` (crash-window matrix + corrupted-store-repairs proof) — ledger ids `m11-consistency-*` |
| Acceptance-coverage-map completeness sweep: 33 mapped entries, 2 deferred (#224 semantic search, #225 album reorder), 1 manual with reason; distribution documented | ✅ #126 (PR #226) | `tests/e2e/coverage-map.json` + `npm run check:acceptance-coverage` |
| Real sample-image fixtures replace gradient placeholders | ⛔ #127 — **blocked on owner** (licensed photos or download approval); flagged on the issue | — |
| Signed & notarized packaging: Developer ID signing + notarization, profile-restricted Touch ID entitlement path, and extracted-ZIP launch gate | ✅ #128; launch regression repair tracked in #357 | `package.yml` + `scripts/verify-macos-app-launch.mjs` + `tests/tooling/macos-signing.test.ts` |
| Security review of the crypto/IPC surfaces: adversarial audit of the AES-256-GCM envelope + keystore, the IPC registry + custom protocol handlers, and a plaintext-at-rest sweep. All three seams sound; zero fix-before-release findings. Fix F1: harness env hooks gated on `!app.isPackaged` (packaged app not env-steerable). Follow-ups #229/#230/#231 filed | ✅ #129 (PR #232) | `tests/import/import-service.test.ts` (env-gate) + [Security Review M11](../Security-Review-M11.md) + [ADR-0004](../adr/ADR-0004-Encryption-And-Key-Management.md#accepted-deviations--review-notes) appendix |

The real-photo fixture row remains owner-blocked on licensed assets. The release-signing row is delivered; credential rotation and provisioning-profile expiry are operational maintenance, not feature blockers.

## macOS release-signing contract

- `CSC_LINK` and `CSC_KEY_PASSWORD` enable Developer ID signing; App Store Connect API-key secrets enable notarization.
- The default signed path uses only Electron hardened-runtime entitlements that do not require a provisioning profile.
- `MAC_PROVISIONING_PROFILE` optionally enables the restricted application/team identifiers required by the native Touch ID Data Protection Keychain path. The package script rejects a mismatched Team ID, application identifier, malformed profile, or expired profile before `electron-builder` runs.
- Without a valid provisioning profile, Touch ID key custody fails closed and password/recovery-key access remains available; the release must still launch.
- The macOS job verifies the final app's embedded profile, active application/team entitlements, biometric usage description, and helper isolation before checking the signature and Gatekeeper assessment. It then extracts the exact generated `*-mac.zip` and launches that packaged app with an isolated user-data directory. A release cannot upload if either identity verification or the packaged-process readiness boundary fails.

### Provisioning-profile ownership and rotation

- The repository owner for Apple Developer Team `Z5DM34QS5U` owns `MAC_PROVISIONING_PROFILE`. The current profile authorizes `Z5DM34QS5U.com.zts1.overlook` and expires **2044-07-12 01:24:19 UTC**. Renewal tracking starts no later than **2044-01-12**; never wait for the expiry gate to fail.
- Generate the replacement as a Developer ID provisioning profile for bundle ID `com.zts1.overlook` under the same Team. Keep the downloaded profile outside the repository and review its application identifier, Team ID, and expiry locally with `OVERLOOK_MAC_PROVISIONING_PROFILE=/path/to/profile node scripts/package-signed-provisioned.mjs --validate-only`.
- Base64-encode the replacement without line wrapping, replace the repository Actions secret `MAC_PROVISIONING_PROFILE`, and dispatch the Package workflow on a release-candidate ref. Both OS legs must pass; the macOS log must show the provisioned signing path, successful notarization, the final-app identity verifier, Gatekeeper acceptance, and exact-ZIP launch.
- Complete the Touch ID hardware checklist below on that artifact before considering rotation complete. If validation or hardware acceptance fails, restore a known-valid unexpired profile secret; do not fall back by adding restricted entitlements to the profile-free build.

## Definition of done

See the epic issue [#46](https://github.com/qwts/photos/issues/46) — the epic body is canonical; this page is the planning index entry.
