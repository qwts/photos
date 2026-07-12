---
'photos': minor
---

Library IPC service: the renderer's typed window into the library — paged
queries with source, chip, and search filters (mock-exact substring
semantics), photo lookup, favorite toggle that bumps pendingCount, sidebar
counts, and StatusBar stats, plus targeted library.changed /
pendingCount.changed push events. The library lazily boots on first use:
keychain-backed keys, SQLCipher database, and blob store under userData.
