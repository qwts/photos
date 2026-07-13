---
'photos': minor
---

Sync-ledger status machine (#104): the ledger vocabulary gains `error`
(migration v2 rebuilds the table), transitions are machine-validated
(illegal ones throw), every library edit dirties through ONE choke-point,
verified completion clears dirty and stamps `last_backup_at`, and the
status bar's backed-up label now reads the real stamp ("JUST NOW" /
"2H AGO", "NEVER" before the first backup). Inspector renders the error
state ("SYNC FAILED — WILL RETRY").
