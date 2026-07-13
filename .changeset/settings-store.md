---
'photos': minor
---

Typed settings store (#111): zod schema with design defaults, atomic JSON persistence in userData with per-key corrupt recovery, `settings:get`/`settings:set` IPC plus `settings:changed` pushes. The backup engine now reads throttle/Wi-Fi/auto-backup live from the store, and auto-backup-on-import is active (default on, per the design).
