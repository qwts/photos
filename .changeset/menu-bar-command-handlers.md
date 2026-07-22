---
'photos': minor
---

Wire the macOS menu's newly-projected commands to their cross-surface handlers, completing #689. File → Move Library… / New Library… open the library switcher (New Library… straight into create mode); File/Photo → Export Selection… / Export… open the Export dialog for the focused photo or selection; Edit → Clear Selection clears the selection; View → Toggle Sidebar shows/hides the sidebar (new `sidebarOpen` state); Photo → Toggle Favorite / Add to Album… / Remove from Album / Move to Trash / Restore act on the focused lightbox photo or the intentional selection, sharing the same handlers and target resolution as the toolbar and context menu (ADR-0024 parity). Each item is disabled with its enablement reason when there is no deterministic target. The native-command router was extracted from `Shell` into `useNativeCommandRouter`.
