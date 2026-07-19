# M04: Library browsing

**Epic:** [#39](https://github.com/qwts/photos/issues/39) · **Lane:** Join A+B

The join point of Lanes A and B: browse a large encrypted library in the shell chrome the design specifies — `TitleBar` → `Toolbar` (48px) → `Sidebar` (216px) + content → `StatusBar` (26px). Zoomable virtualized grid (96–320px square tiles, 4px gaps, **200K-photo target**), 52px-row list view, multi-select with the floating action pill, text search + filter chips, and the backup-button/status-bar states driven by the pendingCount ledger contract (real engine arrives in M08).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#73](https://github.com/qwts/photos/issues/73) | App state store + screen composition shell | #57, #71 |
| [#74](https://github.com/qwts/photos/issues/74) | Virtualized grid engine for the 200K target | #73 |
| [#75](https://github.com/qwts/photos/issues/75) | Thumbnail delivery: decrypting protocol handler + renderer cache | #70 |
| [#76](https://github.com/qwts/photos/issues/76) | Grid view: PhotoTile wiring + zoom slider | #74, #75, #64 |
| [#77](https://github.com/qwts/photos/issues/77) | List view + grid/list toggle | #76 |
| [#78](https://github.com/qwts/photos/issues/78) | Selection model: multi-select, keyboard, floating action pill | #76 |
| [#79](https://github.com/qwts/photos/issues/79) | Toolbar: wordmark, search, filter chips, view/zoom, backup button states | #73, #60 |
| [#80](https://github.com/qwts/photos/issues/80) | Sidebar: sources, albums list, backup status card | #73 |
| [#81](https://github.com/qwts/photos/issues/81) | StatusBar: library stats, sync state, AES-256 indicator | #73 |
| [#82](https://github.com/qwts/photos/issues/82) | E2E browse flows + adopt the acceptance-coverage-map ledger | #76, #77, #78, #79, #80, #81 |

## Definition of done

See the epic issue [#39](https://github.com/qwts/photos/issues/39) — the epic body is canonical; this page is the planning index entry.
