# Acceptance Test — Context Menus

Use a seeded library containing local, backed-up, offloaded, album-member, and Trashed photos.

## Photo selection and actions

1. Right-click an unselected Grid photo. Verify that it becomes the only selected photo and the menu names it.
2. Select several photos, then right-click one selected photo in Grid and List. Verify that the selection stays intact and every action targets that exact set.
3. Verify Open, Favorite, Export, Add to album, Remove from album, Offload or Restore original, Transfer & Sync, and Move to Trash only appear where their service path is valid.
4. In Trash, verify that only Restore and Delete permanently appear. Confirm permanent deletion shows the exact count and custody effects before it runs.

## Keyboard, focus, and placement

1. Open each menu with the Context Menu key and Shift+F10. Verify focus enters the first enabled item.
2. Verify Arrow Up/Down wrap, Home/End jump, and Escape closes the menu and restores focus to its opener.
3. Open menus at every viewport edge in both left-to-right and right-to-left locales. Verify the menu remains fully visible.
4. With a screen reader, verify the menu name, item labels, disabled reasons, and destructive actions are announced without duplicate focus stops.

## Album and Trash sources

1. Open album actions by pointer and keyboard; verify Rename, Transfer & Sync, and Delete album use the same labels and focus behavior as other surfaces.
2. Cancel Rename and Delete album; verify focus returns to the invoking row or action button.
3. Open Trash actions from the sidebar and choose Empty Trash. Verify the confirmation count equals every Trash item, including items beyond the first loaded page.
4. Complete Empty Trash with a simulated provider deletion failure. Verify local and pending-cloud counts are reported separately.
