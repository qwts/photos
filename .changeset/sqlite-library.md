---
'photos': minor
---

Encrypted library database: SQLCipher-keyed SQLite (whole-DB at rest per
ADR-0004), forward-only transactional migrations with schema v1, and a typed
photos repository — keyset pagination, atomic insert with sync-ledger row,
favorite toggle that dirties the ledger, and sidebar source counts.
