---
'photos': minor
---

Permanent purge with retention (#121): the trash pill's destructive Delete opens the confirm ceremony (red button, exact counts, "This can't be undone.") and removes all three copies — DB row first (the local state never lies), local blobs, remote last with retries. A failed remote delete is audited as a repairable ORPHAN-REMOTE (surfaced as an amber "CLOUD COPIES PENDING" toast), shared-hash blobs survive while any row still owns them, and purging owes the remote a fresh manifest generation. Soft-deleted rows auto-purge after 30 days — a fixed constant until a settings control is designed (recorded).
