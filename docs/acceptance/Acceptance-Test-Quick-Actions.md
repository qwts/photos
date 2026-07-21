# Acceptance Test: Gallery Quick Actions

Issue [#532](https://github.com/qwts/photos/issues/532) adds a macOS Command-hover projection of the shared command registry. The same configured actions remain available from each photo's More Actions menu for keyboard and touch users.

## Contract

- Settings persists an ordered, unique list of zero to five eligible command IDs. Reordering and disabling an action take effect without restart.
- Holding Command while a grid tile or list row is hovered or focused reveals actions only for that photo. Release, pointer exit, scroll, window blur, app deactivation, visibility loss, and opening a modal or menu remove the overlay.
- Favorite always targets the surfaced photo. Album, Export, Trash, and Restore target the current selection only when that selection contains the surfaced photo; otherwise they target that photo. The UI exposes the resolved target.
- Trash disables library-only commands with a reason; library views disable Restore with a reason. Destructive commands retain their existing service and custody policies.
- Grid, list, album, search/filter, Favorites, Recent, and Trash all render through the same gallery projection. More Actions and `Shift+F10` provide non-hover access.

## Automated evidence

- `tests/e2e/quick-actions.spec.ts`: modifier lifecycle, scroll cleanup, grid/list parity, photo-vs-selection targets, menu alternative, settings ordering, and disabled explanations.
- `src/renderer/src/grid/QuickActions.stories.tsx`: toolbar semantics, mixed targets, disabled state, and invocation.
- `tests/commands/quick-actions.test.ts`: reducer cleanup, availability, and target resolution.
- `tests/commands/registry.test.ts` and `tests/settings/settings-store.test.ts`: registry projection, bounded persistence, ordering, and invalid-value rejection.

## Manual packaged macOS check

With VoiceOver enabled in a packaged build, verify that Command-hover does not steal focus or announce content repeatedly, the More Actions trigger and context-menu path announce the same labels and target descriptions, Command-click selection never invokes an action, and switching or deactivating the app cannot leave an overlay visible.
