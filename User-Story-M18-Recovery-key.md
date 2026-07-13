# User Story — M18 Recovery key backup & import

Epic [#240](https://github.com/qwts/photos/issues/240), design reference
`design/handoff/ui_kits/app/KeyDialog.jsx` + README §7/7b (updated handoff,
PR #234). Format/KDF: [ADR-0008](ADR-0008-Recovery-Key-Format).

**As a** privacy-conscious photographer, **I want** to export my library key
as a password-encrypted file and import it on another device, **so that** a
keychain loss or device migration never costs me my encrypted photos.

## Acceptance

- Settings → Privacy shows the Recovery key row (fingerprint + Back up… /
  Import…). Backup gates on password + confirmation + strength ≥ Fair + the
  explicit cannot-be-reset acknowledgment; success shows the saved-file card
  and the store-it-safely warning.
- Import accepts a `.key` file (picker or drop) + password; wrong password
  fails closed on the designed copy; a key that doesn't match the library's
  stored key rows is refused.
- Cross-profile round trip proven in CI: export on A, restore A's encrypted
  files to B, import the key, relaunch — A's photos decrypt with A's
  fingerprint (`tests/e2e/keys-recovery.spec.ts`).

Coverage: ledger `m18-recovery-key-backup-import` (e2e + KeyDialog/Settings
stories); crypto unit suite `tests/crypto/recovery.test.ts`.
