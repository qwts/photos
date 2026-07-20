# Acceptance Test: Full-Display Image

Issues: [#501](https://github.com/qwts/photos/issues/501),
[#513](https://github.com/qwts/photos/issues/513),
[#449](https://github.com/qwts/photos/issues/449)

## Purpose

Verify that full view keeps the photo visually dominant, preserves a useful
zoom and focal position while navigating, and resets state at the correct
session boundaries. This script complements automated geometry, Storybook, and
Electron coverage; it does not replace the separate keyboard-pan work in #449.

## Setup

1. Open a library containing adjacent landscape and portrait photos, plus one
   unavailable or corrupt item.
2. Open the first photo in full view at the normal window size.
3. Repeat the matrix at the minimum supported window size and with Inspector
   both closed and docked.

## Image-first chrome

1. Click the displayed image once.
2. Confirm the top bar, navigation, transform controls, metadata strip, and
   Inspector chrome hide, leaving no distraction over the image.
3. Move the pointer or focus a control by keyboard. Confirm the chrome returns.
4. Double-click the image. Confirm Fill activates without the single-click
   gesture hiding the controls before the double-click completes.

## Transform persistence

1. Zoom above Fit and pan to a recognizable edge or subject.
2. Navigate Previous and Next across landscape and portrait photos.
3. Confirm the zoom scale persists and the same normalized focal region remains
   useful. The image must reclamp without blank space, NaN transforms, or a
   stale frame.
4. Double-click a portrait photo to activate Fill, then navigate with the arrow
   keys. Confirm every next photo inherits **Fill behavior**, not the prior
   photo's numeric zoom percentage:
   - a portrait fills edge to edge horizontally and scrolls only vertically;
   - a landscape fills edge to edge vertically and scrolls only horizontally.
5. Pan to an edge and navigate again. Confirm Fill recomputes for each aspect
   ratio while retaining a useful normalized focal direction. At no point may
   both axes require scrolling.
6. Dock and undock Inspector, then resize the window. Confirm the transform
   reclamps and every image continues to cover the required viewport axes.
7. Rotate or flip one photo, then navigate. Confirm orientation resets for the
   next photo while zoom/fill/pan persist.

## Reset and failure boundaries

1. Use **Fit image (0)**. Confirm zoom and pan reset immediately.
2. Zoom again, close full view to the gallery, and reopen any photo. Confirm a
   fresh Fit view with centered pan.
3. Switch libraries or lock and unlock the app, then reopen full view. Confirm
   no transform leaks from the prior session.
4. Navigate from a zoomed photo to an unavailable or corrupt item. Confirm the
   explicit unavailable state appears without blank-space artifacts and the
   transform resets safely before a compatible image is shown again.

## Accessibility and motion

1. At 200% application zoom, confirm every full-view control remains reachable
   and the image does not obscure focused controls.
2. With reduced motion enabled, repeat navigation and reset. Confirm no
   nonessential transform or chrome animation plays.
3. Confirm all visible controls have keyboard focus states and accessible
   names. Keyboard panning remains tracked by #449 until that issue lands.

## Automated evidence

- `tests/lightbox/lightbox-geometry.test.ts`
- `src/renderer/src/lightbox/Lightbox.stories.tsx`
- `tests/e2e/lightbox.spec.ts`
- Acceptance ledger entry `m06-lightbox-transform`

## Required gates

- `npm run ci`
- `npm run test:stories:ci`
- `npm run test:e2e`
