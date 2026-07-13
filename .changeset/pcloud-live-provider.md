---
'photos': minor
---

pCloud is now the storage provider in packaged builds (#109): Connect in Settings → Storage & Backup opens a pCloud sign-in in the browser, and backup, verify, offload, rehydrate, and the quota card run against the live account. Backups upload under `/Overlook/<library-id>/`, encrypted end-to-end — pCloud only ever sees ciphertext. Dev and test builds keep the local mock provider.
