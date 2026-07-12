# M09: Settings & preferences

**Epic:** [#44](https://github.com/qwts/photos/issues/44) · **Lane:** Lane C — Settings

Lane C — starts early (the settings store needs only M01's IPC). Typed, persisted app settings surfaced in the 640px three-pane SettingsDialog: **General** (sort order, appearance — light-theme control ships disabled: the DS has no light theme yet), **Storage & Backup** (provider connection card + quota, auto-backup, copy/move, Wi-Fi-only, bandwidth slider; backup controls disabled when disconnected), **Privacy** (E2E encryption badge always-on, share-diagnostics off by default; face-grouping row ships disabled — the feature is deferred by design despite the mock showing it locked-on; conflict recorded).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#111](https://github.com/qwts/photos/issues/111) | Settings store: typed schema, persistence, change events | #49 |
| [#112](https://github.com/qwts/photos/issues/112) | SettingsDialog shell: 640px two-pane with left nav | #111, #59, #80 |
| [#113](https://github.com/qwts/photos/issues/113) | Settings — General section | #112 |
| [#114](https://github.com/qwts/photos/issues/114) | Settings — Storage & Backup section | #112 |
| [#115](https://github.com/qwts/photos/issues/115) | Settings — Privacy section | #112 |
| [#116](https://github.com/qwts/photos/issues/116) | E2E: settings persist across app restart | #113, #114, #115 |

## Definition of done

See the epic issue [#44](https://github.com/qwts/photos/issues/44) — the epic body is canonical; this page is the planning index entry.
