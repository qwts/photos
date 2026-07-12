---
'photos': minor
---

Selection model completed per the mock: selection now survives filter and
source changes for still-visible photos (intersected with each freshly
loaded page instead of clearing eagerly), and a floating bottom-center pill
shows "{n} SELECTED" with thousands separators plus the bulk-action entry
points — Export, Add to album, Delete (disabled until their epics land) and
clear-×. ⌘/Ctrl+A keeps selecting the visible set; Esc clears (lightbox owns
Esc when open).
