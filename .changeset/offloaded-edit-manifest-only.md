---
'photos': patch
---

Editing an offloaded photo (album add, favorite) no longer breaks the backup run: its blob is already remote, so the edit rides the next manifest generation and the pending indicator settles without re-uploading anything.
