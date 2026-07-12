---
'photos': minor
---

Full-resolution decrypt-to-view delivery (#91): `overlook-full://` serves
originals decrypted in memory under a byte-capped LRU (configurable via
`OVERLOOK_FULL_CACHE_MB`), with `Cache-Control: no-store` keeping plaintext
out of Chromium's disk cache. RAW records resolve to their viewable embedded
preview (by magic, per ADR-0006) with an `X-Overlook-Preview: 1` marker, and
`?prefetch=1` warms neighbors for stall-free lightbox paging.
