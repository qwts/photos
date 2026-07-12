# M05: Import pipeline

**Epic:** [#40](https://github.com/qwts/photos/issues/40) · **Lane:** Lane B — Core

Lane B. Real import from an SD card or folder: volume detection with new-vs-total counting, EXIF extraction, thumbnail generation (RAW via embedded preview for v1), copy-or-move semantics (**Move deletes from source only after verified import** — the design shows an inline amber warning), encrypt-on-import (always on), all with the per-stage progress the ImportDialog renders (copy+encrypt bar, thumbnails bar, mono `n / total` counts).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#83](https://github.com/qwts/photos/issues/83) | ADR-0006: media processing — thumbnails, EXIF, RAW policy, native modules | — |
| [#84](https://github.com/qwts/photos/issues/84) | Volume/folder detection with new-vs-total counting | #83, #49 |
| [#85](https://github.com/qwts/photos/issues/85) | EXIF/metadata extraction module | #83 |
| [#86](https://github.com/qwts/photos/issues/86) | Thumbnail generation worker with RAW embedded-preview fallback | #83, #67, #70 |
| [#87](https://github.com/qwts/photos/issues/87) | Import engine: copy/move + encrypt + record, crash-safe, per-stage progress | #84, #85, #86, #69 |
| [#88](https://github.com/qwts/photos/issues/88) | ImportDialog: options → running (dual progress) → done | #87, #59, #60, #61, #62 |
| [#89](https://github.com/qwts/photos/issues/89) | Recent-imports source + import completion toast | #87 |
| [#90](https://github.com/qwts/photos/issues/90) | E2E: fixture SD-card import end-to-end | #88, #89, #76 |

## Definition of done

See the epic issue [#40](https://github.com/qwts/photos/issues/40) — the epic body is canonical; this page is the planning index entry.
