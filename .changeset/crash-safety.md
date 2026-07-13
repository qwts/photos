---
'photos': minor
---

Crash-safety audit (#125): a ConsistencyChecker detects DB↔blob↔ledger drift (orphan blobs/thumbs, staging leftovers, rows lying about a local original) and repairs what is safe — remote-verified missing blobs become `offloaded` (rehydratable), truly lost blobs become `error` (the red glyph is the honest prompt), orphans and staging strands are removed. A lightweight repair runs at library open. The kill-test matrix consolidates: per-stage import resume (existing), backup mid-upload/mid-verify resume (existing), plus new offload and purge crash-window tests and a deliberately-corrupted-store-repairs-to-consistency proof.
