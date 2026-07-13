---
'photos': patch
---

Source truth (#119): sidebar counts now share `page()`'s per-source where-clauses — one query truth, so counts and grid results cannot drift by construction. A property-style suite pins it: for every source, count === full keyset page-walk total; chips AND with sources ('Local only' means ledger-local, contradictions yield the empty set honestly); deleted rows stay invisible outside the trash.
