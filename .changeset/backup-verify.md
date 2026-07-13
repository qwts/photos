---
'photos': minor
---

Verify-after-upload (#106, ADR-0007): "backed up" is never a lie — the
engine hashes the local ciphertext and compares sha256+size against the
provider's checksum before a row may go synced; mismatches go `error` and
stay dirty (re-queued next run), with every verify result appended to the
backup audit log. Status changes push targeted library updates so tiles
flip to the cloud-alert glyph live, and failed runs raise the red toast
with a Retry action via the new `backup:completed` event.
