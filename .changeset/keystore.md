---
'photos': minor
---

Master-key lifecycle: the master key is generated on first run and persists
only OS-keychain-wrapped; versioned library keys (KEY #N) wrap under it,
rotate forward while retired keys keep decrypting, and an unavailable
keychain is a hard error — never a plaintext fallback.
