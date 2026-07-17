---
'photos': minor
---

Safe library switching and crash-safe lifecycle (ADR-0017 §4/§5, #385): opening another library from the registry now performs a live switch — full teardown (imports cancelled to their journal, backups aborted to the sync ledger, purge drained, WAL checkpointed, keys zeroed), app-lock re-pointed at the new library, and a fresh renderer. Ordinary quits run the same teardown, each library carries an advisory single-instance lock (stale locks from crashes are reclaimed), a second app instance per profile hands off to the first, creating a library provisions its empty database, and a registered library whose directory is missing fails loud instead of being recreated empty.
