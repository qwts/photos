# Acceptance Test: Native Application Menu

Use a packaged macOS build for the native chrome and focus checks. The automated
Electron lane covers the same command IDs in unpackaged builds without showing
test windows.

## Settings and navigation

1. Launch Overlook with an unlocked library and choose **Overlook → Settings…**.
   Confirm one Settings window opens on **General**.
2. Choose Storage & Backup, Transfer & Sync, and Privacy & Diagnostics from the
   Settings Sections submenu. Confirm each command focuses Overlook, reuses the
   same Settings instance, opens the exact pane, and remains idempotent when
   repeated.
3. Repeat from a lightbox and while another modal is open. Confirm incompatible
   overlays close and no duplicate window or dialog remains.
4. Choose All Photos, Favorites, Recent Imports, and Trash. Confirm the route and
   checked menu state follow the focused window.

## Window lifecycle and lock

1. Repeat a Settings-section command while the window is minimized, hidden, and
   the app is inactive. Confirm the existing primary window is restored and
   focused without creating another window.
2. Close the last window without quitting Overlook, then choose Privacy &
   Diagnostics. Confirm exactly one primary window is created and the queued
   route opens once after renderer readiness.
3. Configure app lock, lock Overlook, and inspect the menu. Confirm Import,
   photo, selection, and protected route commands are disabled; Settings,
   Privacy & Diagnostics, Help, and Quit reveal no library names or counts.
4. Choose Privacy & Diagnostics while locked. Confirm protected content remains
   absent. Unlock and confirm the pending route opens Privacy exactly once.
5. Start incompatible provider work and confirm Import is disabled. Attempt any
   stale invocation and confirm main-process revalidation refuses it.

## Platform and accessibility

1. Confirm macOS ordering: Overlook, File, Edit, View, Photo, Window, Help; OS
   roles retain native names and behavior, and Settings displays Command-comma.
2. Focus an editable field and confirm Select All remains the native text-editing
   role. Move focus to the gallery and confirm Select All targets the collection.
3. Traverse every renderer destination by keyboard after menu invocation and
   confirm focus is not lost behind a closed overlay.
