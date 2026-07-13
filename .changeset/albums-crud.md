---
'photos': minor
---

Albums CRUD (#117): create/rename/delete albums and add/remove membership over typed `album:*` IPC — deleting an album never deletes photos (Clear-vs-Delete rules) and every album edit dirties the affected photos for the next manifest (ADR-0007). The sidebar Albums section goes live: inline create from the + affordance, live counts, and an album as the active source filtering the grid (`library:page` gains `albumId`).
