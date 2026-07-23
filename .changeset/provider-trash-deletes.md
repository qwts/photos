---
'overlook': patch
---

Remote deletions are recoverable everywhere the provider supports it (#750): Google Drive now trashes (`PATCH {"trashed": true}`, 30-day Drive trash) instead of issuing permanent `DELETE /files/{id}`; pCloud's trash-backed `deletefile` (60-day Trash) and iCloud Drive's Recently Deleted (30 days) are documented as relied-upon contracts. The provider contract now states the product rule: no code path may permanently destroy a remote object where a recoverable deletion exists.
