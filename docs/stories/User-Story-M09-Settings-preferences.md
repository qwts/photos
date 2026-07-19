# M09: Settings & preferences

**Epic:** [#44](https://github.com/qwts/photos/issues/44) · **Lane:** Lane C — Settings

Lane C — starts early (the settings store needs only M01's IPC). Typed, persisted app settings surfaced in the 640px three-pane SettingsDialog: **General** (sort order, appearance — light-theme control ships disabled: the DS has no light theme yet), **Storage & Backup** (provider connection card + quota, auto-backup, copy/move, Wi-Fi-only, bandwidth slider; backup controls disabled when disconnected), **Privacy** (E2E encryption badge always-on, share-diagnostics off by default; face-grouping row ships disabled — the feature is deferred by design despite the mock showing it locked-on; conflict recorded).

## Issues

| #                                                 | Title                                                    | Blocked by       |
| ------------------------------------------------- | -------------------------------------------------------- | ---------------- |
| [#111](https://github.com/qwts/photos/issues/111) | Settings store: typed schema, persistence, change events | #49              |
| [#112](https://github.com/qwts/photos/issues/112) | SettingsDialog shell: 640px two-pane with left nav       | #111, #59, #80   |
| [#113](https://github.com/qwts/photos/issues/113) | Settings — General section                               | #112             |
| [#114](https://github.com/qwts/photos/issues/114) | Settings — Storage & Backup section                      | #112             |
| [#115](https://github.com/qwts/photos/issues/115) | Settings — Privacy section                               | #112             |
| [#116](https://github.com/qwts/photos/issues/116) | E2E: settings persist across app restart                 | #113, #114, #115 |
| [#492](https://github.com/qwts/photos/issues/492) | Responsive Settings scrolling and dialog motion          | #112             |

## Acceptance coverage

| Flow                                                                                                                                                                                                                                              | Status            | Coverage                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings store: typed zod schema (design defaults), atomic JSON persistence, per-key corrupt recovery, `settings:get/set/changed` IPC; backup engine reads throttle/Wi-Fi/auto-backup live; auto-backup-on-import active (imports + crash-resume) | ✅ #111 (PR #210) | `tests/settings/settings-store.test.ts` + `tests/e2e/settings.spec.ts` — ledger id `m09-settings-store`                                                                                |
| SettingsDialog shell: 640px two-pane, 160px icon+label nav, Storage & Backup default-open, keyboard-operable, gear entry on the sidebar card                                                                                                      | ✅ #112 (PR #211) | `SettingsDialog.stories.tsx` play tests + e2e — ledger id `m09-settings-dialog-shell`                                                                                                  |
| General: sort order (Date/Name/Size) re-orders the grid LIVE and persists — keyset-safe `order` param with matching indexes (migration v3, query-plan pinned); appearance Light-disabled + dark-only hint; thumbnails locked on                   | ✅ #113 (PR #212) | e2e + stories + `tests/db/library-db.test.ts` — ledger id `m09-settings-general`                                                                                                       |
| Storage & Backup: connection card (badge, live provider quota, Connect/Disconnect → providerId), auto-backup/copy-move/Wi-Fi/bandwidth controls ALL disabled when disconnected; disconnect blocks manual runs too; ImportDialog shares importMode | ✅ #114 (PR #213) | e2e + stories — ledger id `m09-settings-storage`                                                                                                                                       |
| Privacy: always-on E2E badge (factual copy), face grouping shipped disabled as "not yet available" (mock's locked-on state deferred by design, not faked), diagnostics off-by-default with local-only honesty                                     | ✅ #115 (PR #214) | e2e + stories — ledger id `m09-settings-privacy`                                                                                                                                       |
| Acceptance: settings persist across a REAL app relaunch — store reports, grid re-renders in persisted order unprompted, disconnected card re-renders, manual backup stays blocked                                                                 | ✅ #116 (PR #215) | `tests/e2e/settings-restart.spec.ts` — ledger id `m09-settings-restart-persistence`                                                                                                    |
| Provider-neutral selection: addressed list/status/connect/disconnect, explicit capabilities, honest unknown quota, and switching blocked during backup/restore                                                                                    | ✅ #280 (PR #298) | settings E2E + stories + provider runtime/contract tests — ledger id `m09-provider-selection-capabilities`; [ADR-0011](../adr/ADR-0011-Provider-Catalog-Capabilities-And-Switching.md) |
| Responsive dialog: Settings opens at its final bounded size before provider results arrive; navigation stays fixed while only the active pane scrolls; section changes reset scroll; open/close motion honors reduced motion and restores focus   | 🟡 #492           | Settings/Dialog stories + Settings E2E — ledger id `m09-settings-responsive-dialog`                                                                                                    |

Recorded decisions: sort semantics — date newest-first, name A→Z (case-insensitive), size largest-first; `bandwidthLimit` 100 = unlimited (mock's `80` read as demo state, product default is unlimited); the connection card names the ACTUAL provider ("Mock provider" until #109 ships pCloud) rather than faking a pCloud connection; automatic backup successes are quiet (status bar flips; no green toast — it raced the import toast), manual runs toast green, failures always loud.

## Definition of done

See the epic issue [#44](https://github.com/qwts/photos/issues/44) — the epic body is canonical; this page is the planning index entry.
