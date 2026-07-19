---
'photos': minor
---

Journaled library relocation service and IPC (ADR-0022, #483): new `library-relocation:*` channels move a registered library with a copy → verify (SHA-256 + staged-DB custody check) → atomic registry commit → cleanup protocol; moving the active library quiesces it through the full teardown contract and reopens it at the destination (or, on any pre-commit failure, at the untouched source). Startup now settles relocation journals before opening a library — resuming committed cleanups, discarding marker-bound staging, and rolling forward a crash caught between the registry rewrite and the journal advance. Failure before the commit always leaves the original registered and usable; a cleanup failure after the commit reports both verified copies and offers a safe retry, never guessing which to delete.
