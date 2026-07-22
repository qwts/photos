---
'photos': minor
---

Rebuild the macOS application menu to the design-system `MenuBar` six-menu spec (#689): **Overlook · File · Edit · View · Photo · Help**, in exact order — dropping the Window menu, flattening the Settings-sections submenu into top-level Overlook items, always showing Lock Now (disabled without an app password), and making the Photo menu target-aware (Restore in Trash; Favorite / Add to Album / Remove from Album / Export / Move to Trash otherwise). New registry commands project into the menu — `library.move` (⇧⌘M), `library.new`, `view.sidebar.toggle`, `view.mode.feed`, `view.mode.moodboard` — plus native exposure for `photo.export` (⇧⌘E), `selection.clear`, `photo.restore`, and album add/remove, with `library.import` bound to ⌘I. Their cross-surface handlers land in a follow-up, so newly-projected items stay disabled for now. Windows/Linux menus are unchanged.
