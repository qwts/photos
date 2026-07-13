---
'photos': minor
---

Soft delete (#120): Delete is safe by default — the selection pill's Delete and the lightbox trash button move photos to the Recently deleted source (blobs, ledger, and album membership untouched), where the pill flips to Restore. Deleted rows leave pendingCount and the upload queue; restore brings favorite/EXIF/ledger status back intact and re-dirties the row for the next manifest. Permanent purge is #121's destructive ceremony.
