---
'photos': minor
---

Crypto engine: streaming AES-256-GCM envelopes per ADR-0004 — 4 MiB chunks
with per-chunk auth tags, AAD binding photo id / key id / chunk index, a
truncation-detecting final marker, and key-versioned decryption. Tamper,
reorder, truncation, wrong-key, and wrong-context all fail loudly.
