---
'photos': patch
---

Lightbox chrome can now actually auto-hide while the pointer rests on it:
Chromium re-dispatches a synthetic mousemove when the fade's pointer-events
flip changes hit-testing under a stationary cursor, which re-woke the chrome
in a loop. Stationary events are now ignored; only real movement wakes.
