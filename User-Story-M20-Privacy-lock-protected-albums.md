# M20: Privacy Lock, Touch ID, and Protected Albums

**Epic:** [#305](https://github.com/qwts/photos/issues/305) · **Lane:** Lane B — Core with Lane A/C UI

M20 adds a cryptographic whole-app lock, opt-in native Touch ID release on supported signed macOS builds, and independently authorized protected albums. [ADR-0013](ADR-0013-App-Lock-Key-Release-And-Protected-Albums) is the prerequisite contract: locked means the main process has no decryption authority, recovery remains rooted in the ADR-0008 file, and protected content occupies a separate key/query domain.

## Delivery order

| #                                                 | Title                                           | Dependency                     |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| [#308](https://github.com/qwts/photos/issues/308) | ADR: credential, recovery, and key release      | First                          |
| [#311](https://github.com/qwts/photos/issues/311) | App-lock lifecycle, settings, and unlock screen | #308                           |
| [#310](https://github.com/qwts/photos/issues/310) | Native Touch ID with password fallback          | #308 and #311 key-release seam |
| [#309](https://github.com/qwts/photos/issues/309) | Protected albums and leakage isolation          | #308                           |

## Implementation status

- #308 contract: complete; ADR-0013 accepted.
- #311 app-lock lifecycle: implemented by [PR #323](https://github.com/qwts/photos/pull/323). Configured launch withholds the master key until password release; main-process IPC/protocol admission, crash-resumable OVLK/anchor transitions, persistent throttling, recovery-file re-establishment, lifecycle locking, work drain, cache zeroization, Privacy controls, and the dedicated lock surface are covered.
- #310 Touch ID and #309 protected albums remain separate deferred deliveries. The disabled Touch ID control is intentional until the native signed-build adapter exists.

## Product and privacy rules

- Configured launch starts locked before database, key store, thumbnails, or library UI opens.
- Locking revokes main-process authority, cancels sensitive work, clears caches, closes the database, and zeroizes keys.
- Password, derived key, biometric, decrypted metadata, and protected route state never enter renderer persistence, logs, telemetry, provider plaintext, or ordinary temp files.
- App-password recovery requires the separately saved recovery file; without it, reset is destructive erase.
- Touch ID is opt-in, current-enrollment/device-only, signed-build-only, revocable, and always offers password fallback.
- Protected photos, metadata, names, counts, thumbnails, exports, sync state, routes, and diagnostics remain outside every ordinary library surface.
- A photo belongs to at most one protected key domain; conflicts require an explicit authorized move.

## Locked boundary

The only locked-state actions are status, password unlock, supported biometric request, recovery-file selection/import, safe window controls, and quit. Library/album/settings mutations, protocols, import/export, backup/restore, provider operations, menus, shortcuts, deep links, caches, recents, and diagnostics fail closed in the main process.

## Recovery summary

The app password releases a random unlock key that wraps the existing master. The ADR-0008 recovery file continues to carry the master itself, so a fresh machine can restore the library and set a new local app password without knowing the forgotten one. Touch ID is disabled after recovery or password changes until the user opts in again. Protected-album password recovery requires that same recovery-file ceremony.

## Acceptance coverage

The complete testable matrix is in ADR-0013. The repo ledger tracks:

- `m20-app-lock-lifecycle` → `tests/e2e/app-lock.spec.ts`, lock-screen Storybook interactions, custody/state-machine tests, and packaged manual evidence
- `m20-touch-id-unlock` → #310
- `m20-protected-albums` → #309

Each remaining child replaces its deferred entry with unit, Storybook, Electron E2E, security-review, and required signed-build/manual evidence. The epic closes only after the bypass, crash/restart, accessibility, recovery, and leakage matrices all pass.

### #311 packaged acceptance checklist

1. Configure an app password, quit, and confirm the next launch shows no library frame before the lock surface.
2. Exercise Lock now, native screen lock, suspend/resume, user switch, idle choices, and optional minimize/hide on macOS and Windows.
3. Confirm password-manager behavior, keyboard-only focus order, screen-reader announcements, reduced motion, and minimum-window layout.
4. Run backup/import/export before locking and confirm lock cancels or drains it without corrupting the library; a hung operation must relaunch locked.
5. Change and remove the password with correct and incorrect current credentials; recover with the matching exported key and reject another library's key.
