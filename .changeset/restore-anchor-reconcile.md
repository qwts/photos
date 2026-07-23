---
'overlook': patch
---

Restoring a library no longer strands the next launch on the app-lock
"Recovery required" screen: activation reconciles the ADR-0013 freshness
anchor so the restored library reads as its true lock state instead of a
rollback attack. A restore that never activates leaves the anchor untouched.
