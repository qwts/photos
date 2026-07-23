---
'overlook': minor
---

Restoring with this Mac's stored key now demands fresh app-password authority whenever an app lock is configured — enforced in the main process, sharing the lock's unlock throttle — and a restore granted that authority re-establishes the password-derived app-lock record with a matching credential anchor for the activated library, instead of leaving it on downgraded keychain-form custody (#754).
