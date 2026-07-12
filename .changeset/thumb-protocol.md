---
'overlook-photos': minor
---

Thumbnail delivery: the `overlook-thumb://` protocol streams decrypts from
the encrypted blob store straight into `<img>` tags — memory-only, no
plaintext files. Main keeps a byte-capped LRU of decrypted thumbs over a
small decrypt semaphore with in-flight dedup and cancellation for
scrolled-past requests; content-addressed responses ship immutable cache
headers so the renderer's HTTP cache short-circuits repeats. Missing thumbs
404 (renderer placeholder until M05 backfills). The dev/E2E seed now writes
real encrypted thumbs and its sample JPEGs actually decode.
