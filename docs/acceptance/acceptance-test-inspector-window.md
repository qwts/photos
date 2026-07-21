# Inspector Follow And Detached Window Acceptance

Issue: [#503](https://github.com/qwts/photos/issues/503)

## Automated evidence

- `tests/library/app-state.test.ts` covers lightbox ownership, stable multi-selection order, cursor repair, and detach/reattach state.
- `src/renderer/src/inspector/Inspector.stories.tsx` covers the accessible selection count and Previous/Next controls.
- `tests/e2e/inspector-window.spec.ts` covers the keyboard shortcut, secondary window, selection paging, close, and dock reattachment.
- `tests/e2e/app-lock.spec.ts` proves both renderer documents discard Inspector content when the library locks.

## Manual test

1. Select three photos in a filtered or sorted gallery and open Inspector. Expected: it reports `1 of 3 selected`; Previous and Next follow visible gallery order and wrap.
2. Remove the focused photo from the selection, then change the filter. Expected: Inspector moves to the next still-visible selected photo without showing stale metadata.
3. Open a photo in lightbox, open Inspector, then close lightbox. Expected: the lightbox-owned dock closes.
4. Press Command-Shift-I on macOS or Control-Shift-I on Windows/Linux. Expected: one native Inspector window opens and follows gallery or lightbox focus; repeating the command focuses the same window.
5. Close the secondary window, then press I. Expected: the docked Inspector opens and follows the current selection.
6. Configure app lock, detach Inspector, and lock the app. Expected: both windows replace content with the lock screen; filenames, thumbnails, and metadata are absent until unlock.

## Failure cases

- Clearing selection leaves an intentional empty Inspector state, never the prior photo.
- Deleting or filtering out the focused item cannot retain its metadata.
- Closing the primary window also closes the detached Inspector.
