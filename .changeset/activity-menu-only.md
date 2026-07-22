---
'photos': minor
---

Move Activity to a Help-menu command surface (#690). Activity is a command
(ADR-0024 / ADR-0025), not a library source or album, so its misplaced row
beneath the sidebar ALBUMS `+` control is removed. It now projects from the
shared registry as `help.activity` ("Activity…", `database`) in the Help menu,
opening the same `ActivityDialog`; the command is per-library and disabled while
the library is locked.
