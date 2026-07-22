---
'photos': minor
---

Include moodboards in encrypted backup and restore (part of #515). The backup
manifest advances to schema 5, carrying each board with its ordering/identity as
canonical serialized layout; restore rebuilds the boards into the staged catalog
and the post-restore deep-equality check now verifies boards alongside photos
and albums. This completes the backup/restore half of invariant I2 — a board's
exact layout survives a backup and restore round trip. Schema-4 manifests remain
readable; boards are absent from them and restore to none.
