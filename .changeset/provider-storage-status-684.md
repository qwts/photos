---
'photos': minor
---

Report real backup usage on the provider storage cards and redesign the status
presentation (#684). Each connected card now shows two independently-sourced
figures that never blend: **Used by Overlook** — the exact byte sum of
Overlook's own remote objects, measured through the storage-provider seam — and,
separately, account-wide **capacity**, shown as a bar only when a verified quota
API supplies it (Google Drive `about.storageQuota`, pCloud `userinfo`). iCloud
has no trustworthy account-quota API, so it reports the used figure plus an
honest "iCloud capacity — View in System Settings" route and never fabricates a
total or passes off local Mac disk space as account capacity. The
`STORAGE USAGE NOT REPORTED` line is gone.

The card gains loading, offline/stale (last-known figure retained and marked
stale with its timestamp), and calculation-failure states; a usage or quota
failure no longer flips connection authority. Usage refreshes after backup
completion, reconnect, and app restart, plus a manual Refresh. Connection
authority, auth, backup/restore/offload, and Touch ID behavior are unchanged.
