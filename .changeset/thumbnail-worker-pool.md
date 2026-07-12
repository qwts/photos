---
'photos': minor
---

Thumbnail generation worker (#86): a bounded `worker_threads` pool runs sharp
off the main thread producing the ADR-0006 derivatives (512px WebP q80 thumb,
2048px WebP q85 mid — sRGB, metadata stripped), RAF originals resolve their
embedded preview first, undecodable bytes record a placeholder instead of
failing the import, and derivatives stream encrypted into the blob store
(encrypt-then-move, no plaintext temp files). A crashed worker rejects only
its own job and the pool respawns without leaking capacity.
