---
'photos': minor
---

Export engine (#97): selected photos become real files in a chosen folder —
streaming decrypt straight to the destination with original filenames
(collisions get a recorded numbered suffix), free-space preflight before any
bytes move, ordered n/total progress events, and cancellation that finishes
the file in flight and keeps completed files. New `export:*` IPC surface
(pick-destination via the OS folder picker, run, cancel, progress). v1 ships
no encrypted-export format — the dialog's decrypt-off switch will simply
disable Export (recorded on #97).
