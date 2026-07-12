# M08: Backup & offload engine (provider abstraction, mock-first)

**Epic:** [#43](https://github.com/qwts/photos/issues/43) · **Lane:** Lane B — Core (tail)

Lane B tail — the biggest domain epic. Verified encrypted backup with per-photo sync states (local/syncing/synced/offloaded/error), the **pendingCount dirtiness ledger** (any library edit increments; a completed backup clears; toolbar backup button disabled at zero — "All photos backed up"), offload (evict local original only after verified upload; on-demand rehydrate), bandwidth throttle, Wi-Fi-only gate, auto-backup-on-import.

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#102](https://github.com/qwts/photos/issues/102) | ADR-0007: backup format, remote layout, offload semantics, interop stance | #65 |
| [#103](https://github.com/qwts/photos/issues/103) | Storage-provider interface + local mock provider (CI target) | #102 |
| [#104](https://github.com/qwts/photos/issues/104) | Sync ledger + per-photo status machine + pendingCount semantics | #102, #69 |
| [#105](https://github.com/qwts/photos/issues/105) | Backup engine: queue, retries, throttle, Wi-Fi gate, auto-backup | #103, #104, #111 |
| [#106](https://github.com/qwts/photos/issues/106) | Upload verification + error surfacing | #105 |
| [#107](https://github.com/qwts/photos/issues/107) | Offload: evict verified originals, rehydrate on demand | #106 |
| [#108](https://github.com/qwts/photos/issues/108) | Backup UI wiring: toolbar, status bar, glyphs, sidebar card | #105, #79, #80, #81 |
| [#109](https://github.com/qwts/photos/issues/109) | pCloud live provider: OAuth loopback + API client (needs credentials) | #103 |
| [#110](https://github.com/qwts/photos/issues/110) | E2E: backup, verify, offload, rehydrate against the mock provider | #107, #108 |

## Definition of done

See the epic issue [#43](https://github.com/qwts/photos/issues/43) — the epic body is canonical; this page is the planning index entry.
