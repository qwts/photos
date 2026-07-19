# Image Trail Transfer and Sync UI

## Purpose

Verify that Overlook exposes the shared Transfer and Sync vocabulary from photo
selection, album, lightbox, toolbar, and Settings while preserving selection,
active view, album context, and truthful original custody.

## Automated evidence

- `tests/interop/visible-workflow.test.ts` covers provider and pairing gating,
  exact zero custody before review, and canonical recovery labels.
- `src/renderer/src/interop/InteropWorkflowDialog.stories.tsx` covers review,
  conflicts, transferring, paused, awaiting acknowledgement, partial failure,
  completion, disconnected provider, narrow layout, and keyboard interaction.
- Browse, lightbox, and album Playwright specs remain the regression gate for
  targeted dialog behavior and preserved renderer state.

## Manual script

1. Open Transfer & Sync from a photo selection, an album action menu, a
   lightbox, the toolbar, and Settings.
2. Confirm the entry context and exact total are retained. Until an isolated
   provider and pairing bundle exist, eligibility remains unchecked, all review
   and acknowledgement counts remain zero, and Start stays disabled.
3. In Storybook, exercise Move to Image Trail, Move to Overlook, Sync, every
   review category, all conflict choices, Apply to all, pause, cancel, resume,
   reconnect, disconnect, partial failure, awaiting acknowledgement, and
   completion.
4. Confirm progress separates processed, acknowledged, and finalized counts.
   Unavailable originals remain metadata-only, unsupported fields remain
   visible for round trip, and web origin/provenance is never promoted to EXIF.
5. Repeat at narrow width and by keyboard. Close the dialog and confirm the
   selected ids, active grid/list view, album, lightbox, scroll, and backup
   pending state are unchanged.

## Live-provider boundary

pCloud, Google Drive, and packaged signed iCloud credentials are owner-run
evidence for issue #337. Interop must not reuse backup connection state or
simulate pairing, quota, provider availability, acknowledgement, verification,
or completion.

## Reset

Close the dialog. Disconnecting interop stops future sync without deleting
either library. No source removal may occur before verified target durability.
