# M07: Export

**Epic:** [#42](https://github.com/qwts/photos/issues/42) · **Lane:** Lane B — Core

Lane B. The counterpart to encrypted storage: exporting writes real, openable files. ExportDialog per the design — format segmented (Original/JPEG), **"Decrypt originals" switch on by default; turning it off disables Export and shows the amber warning** ("exported files can't be opened outside Overlook"), destination picker, running progress ("Decrypting & writing" vs "Writing"), done summary. Entry points: multi-select action pill and the lightbox export icon (count=1).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#97](https://github.com/qwts/photos/issues/97) | Export engine: decrypt + write originals with progress | #67, #70 |
| [#98](https://github.com/qwts/photos/issues/98) | JPEG transcode export path | #97, #86 |
| [#99](https://github.com/qwts/photos/issues/99) | ExportDialog: format, decrypt switch, destination, progress | #97, #59, #60, #61 |
| [#100](https://github.com/qwts/photos/issues/100) | Export entry points: selection action pill + lightbox | #99, #78, #92 |
| [#101](https://github.com/qwts/photos/issues/101) | E2E: select → export → decrypted files on disk | #100 |

## Definition of done

See the epic issue [#42](https://github.com/qwts/photos/issues/42) — the epic body is canonical; this page is the planning index entry.
