# M06: Lightbox & Inspector

**Epic:** [#41](https://github.com/qwts/photos/issues/41) · **Lane:** Lane A — UI

Lane A. Full-window single-photo viewing with decrypt-to-view delivery (memory-only, LRU-capped — plaintext never touches disk), the auto-hiding chrome the design specifies (fade in on mouse move, hide after ~2.2s), ←/→ navigation with wraparound, Esc dual semantics (clear selection vs. exit lightbox), `i` toggling the 280px right-docked Inspector with grouped MetadataRows (file / camera / backup — "ENCRYPTED · PCLOUD · 2H AGO", "AES-256-GCM · KEY #2").

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#91](https://github.com/qwts/photos/issues/91) | Full-resolution decrypt-to-view delivery (memory-only, LRU) | #67, #70 |
| [#92](https://github.com/qwts/photos/issues/92) | Lightbox: full-window view with auto-hiding chrome | #76, #91 |
| [#93](https://github.com/qwts/photos/issues/93) | Lightbox keyboard: ←/→ navigation, Esc dual semantics, i for inspector | #92 |
| [#94](https://github.com/qwts/photos/issues/94) | Inspector: grouped metadata panel | #92, #62 |
| [#95](https://github.com/qwts/photos/issues/95) | Lightbox mutations: favorite/delete dirty the backup ledger | #92 |
| [#96](https://github.com/qwts/photos/issues/96) | E2E: grid → lightbox → inspector acceptance flow | #93, #94, #95 |

## Definition of done

See the epic issue [#41](https://github.com/qwts/photos/issues/41) — the epic body is canonical; this page is the planning index entry.
