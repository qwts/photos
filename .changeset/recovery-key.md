---
'photos': minor
---

Recovery key backup and import (Settings → Privacy): export the library's master key as a password-encrypted `overlook-recovery.key` (scrypt + AES-256-GCM, password + confirmation with a strength meter and an explicit cannot-be-reset acknowledgment), and import a `.key` file on another device to unlock a restored library. Install validates the key against the library's stored key rows and never overwrites working custody it can't vouch for; wrong passwords fail closed.
