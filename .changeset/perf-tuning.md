---
'photos': patch
---

Perf tuning to budget (#124): sidebar counts run as ONE FILTER-clause pass over the ledger join instead of five separate counts (689ms → 378ms at 200K; ratchet tightened to 500ms), with the offloaded predicate now join-based so page() and counts() still share one where-clause truth. Zoom-96 scroll drops stay within budget; the disk-cache lever is rejected on privacy grounds (decrypted thumbs never hit disk — ADR-0004, recorded).
