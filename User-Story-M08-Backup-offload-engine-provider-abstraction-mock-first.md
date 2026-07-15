# M08: Backup & offload engine (provider abstraction, mock-first)

**Epic:** [#43](https://github.com/qwts/photos/issues/43) · **Lane:** Lane B — Core (tail)

Lane B tail — the biggest domain epic. Verified encrypted backup with per-photo sync states (local/syncing/synced/offloaded/error), the **pendingCount dirtiness ledger** (any library edit increments; a completed backup clears; toolbar backup button disabled at zero — "All photos backed up"), offload (evict local original only after verified upload; on-demand rehydrate), bandwidth throttle, Wi-Fi-only gate, auto-backup-on-import.

## Issues

| #                                                 | Title                                                                     | Blocked by          |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------- |
| [#102](https://github.com/qwts/photos/issues/102) | ADR-0007: backup format, remote layout, offload semantics, interop stance | #65                 |
| [#103](https://github.com/qwts/photos/issues/103) | Storage-provider interface + local mock provider (CI target)              | #102                |
| [#104](https://github.com/qwts/photos/issues/104) | Sync ledger + per-photo status machine + pendingCount semantics           | #102, #69           |
| [#105](https://github.com/qwts/photos/issues/105) | Backup engine: queue, retries, throttle, Wi-Fi gate, auto-backup          | #103, #104, #111    |
| [#106](https://github.com/qwts/photos/issues/106) | Upload verification + error surfacing                                     | #105                |
| [#107](https://github.com/qwts/photos/issues/107) | Offload: evict verified originals, rehydrate on demand                    | #106                |
| [#108](https://github.com/qwts/photos/issues/108) | Backup UI wiring: toolbar, status bar, glyphs, sidebar card               | #105, #79, #80, #81 |
| [#109](https://github.com/qwts/photos/issues/109) | pCloud live provider: OAuth loopback + API client (needs credentials)     | #103                |
| [#110](https://github.com/qwts/photos/issues/110) | E2E: backup, verify, offload, rehydrate against the mock provider         | #107, #108          |
| [#302](https://github.com/qwts/photos/issues/302) | Bounded integrity scrub repairs remote damage and recovery metadata       | #291                |

## Acceptance coverage

| Flow                                                                                                                                                                                                    | Status                  | Coverage                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0007 accepted: remote layout `/Overlook/<library-id>/{manifest,blobs/<h2>/<hash>}`, encrypt-once envelopes, generation-numbered encrypted manifest (N=2), verify-gates-offload, mock-first provider | ✅ #102 (wiki ADR-0007) | ADR page + epic decisions                                                                                                                                                                     |
| StorageProvider interface + MockProvider (fs-backed; quota/auth simulation, path-traversal guards, overwrite-aware quota) + FaultInjectingProvider + registry                                           | ✅ #103 (PR #200)       | `tests/backup/mock-provider.test.ts`                                                                                                                                                          |
| Sync ledger: per-photo status machine (local/syncing/synced/offloaded/error), illegal transitions throw, markDirty choke-point, pendingCount, migration v2                                              | ✅ #104 (PR #202)       | `tests/backup/sync-ledger.test.ts` + `tests/db/migrations.test.ts`                                                                                                                            |
| Backup engine: dirty-set queue, resume, retry ×3 backoff, auth/quota break, throttle, Wi-Fi gate, manifest-owed retry, auto-backup-on-import                                                            | ✅ #105 (PR #203)       | `tests/backup/backup-engine.test.ts` (real ledger + mock provider)                                                                                                                            |
| Verify-after-upload (local ciphertext sha256 vs provider.verify gates `synced`), error status + red surfacing, audit log                                                                                | ✅ #106 (PR #204)       | `tests/backup/backup-engine.test.ts`                                                                                                                                                          |
| Offload eligibility (verified-synced + clean + shared-hash guard), thumbs stay, atomic rehydrate (staged + decrypt-rehash before publish)                                                               | ✅ #107 (PR #205)       | `tests/backup/offload.test.ts` (byte-identical round-trip)                                                                                                                                    |
| Backup UI: toolbar button (disabled at 0), status-bar amber/green with live counts + JUST NOW stamp, tile glyphs, sidebar LOCAL·PCLOUD card with progress                                               | ✅ #108 (PR #207)       | `tests/e2e/backup.spec.ts` — ledger id `m08-backup-choreography`                                                                                                                              |
| Acceptance: edit-re-dirties, offload → lightbox rehydrate round-trip, forced-upload-error → red retry toast + error glyph (`OVERLOOK_BACKUP_FAULT`)                                                     | ✅ #110 (PR #208)       | `tests/e2e/backup.spec.ts` — ledger id `m08-backup-faults-and-offload`                                                                                                                        |
| pCloud live provider (OAuth loopback + API client)                                                                                                                                                      | ⏳ #109 open            | Blocked on owner credentials; mock provider is the CI target (ADR-0007)                                                                                                                       |
| Continuous integrity scrub: provider-scoped resume cursor, local-backed repair, remote-only fail-closed state, bootstrap/latest-manifest regeneration, targeted UI summaries                            | ✅ #302 (PR #312)       | `tests/backup/integrity-scrubber.test.ts`, `tests/backup/recovery-health.test.ts`, `tests/backup/integrity-disaster-recovery.test.ts`, and opt-in `tests/backup/pcloud-live-contract.test.ts` |

Recorded decisions: blobs travel encrypted-once (never re-encrypted, never decrypted for backup); verify-after-upload is the trust chain that offload eligibility relies on; offloaded tiles keep thumbnails (browsable offline) rendered dimmed at 55%; `unknown` network state proceeds under the Wi-Fi-only gate; Image Trail interop = write only under `/Overlook/`, import deferred.

## Definition of done

See the epic issue [#43](https://github.com/qwts/photos/issues/43) — the epic body is canonical; this page is the planning index entry.
