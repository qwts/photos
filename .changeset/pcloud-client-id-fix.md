---
'photos': patch
---

Fix pCloud sign-in: v0.13.0 shipped with the wrong OAuth client id, so Connect failed at the authorize step. (The mistaken value was the app's client secret; it has been rotated — the implicit flow never uses a secret, so nothing else changes.)
