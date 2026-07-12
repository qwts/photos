---
'photos': minor
---

Import engine (#87): source files become encrypted, verified library records
through a per-file pipeline (hash → skip-if-known → encrypt-stream → EXIF →
single-transaction record with a dirty sync-ledger row → thumbnails), driven
over the new `import:run` channel with two aggregate progress events
(copy+encrypt and thumbnails). A staging-manifest journal makes every batch
interruptible: a relaunch resumes idempotently, and Move deletes each source
file only after that file's blob passes a full decrypt-and-rehash
verification — per file, never end-of-batch.
