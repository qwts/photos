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

Cloud disaster recovery extends this delivered local-file flow through
[ADR-0009](ADR-0009-Cloud-Recovery-Bootstrap-And-Manifest-V2): the same
recovered master key opens a provider-hosted wrapped-key bootstrap, which then
resolves manifest and blob envelope keys without copying the old `keys.json` or
database. Delivery is tracked by [#287](https://github.com/qwts/photos/issues/287).

The provider-neutral staging, resume, verification, and atomic-activation
contract is recorded by
[ADR-0010](ADR-0010-Cloud-Restore-Staging-And-Atomic-Activation) and delivered
by [#288](https://github.com/qwts/photos/issues/288). The complete user workflow
is delivered by [#290](https://github.com/qwts/photos/issues/290): a fresh
profile can connect a provider, open the separately held recovery key,
discover and validate remote libraries, inspect generation/count/size and
fallback/resume state, confirm replacement, follow typed progress, cancel, and
resume. The same workflow is available from Settings → Storage & Backup for
replacing an existing local library; activation is rollback-safe and relaunches
into the restored catalog.

Coverage: ledger `m18-cloud-disaster-recovery-workflow`; cross-profile Electron
acceptance in `tests/e2e/restore-cloud.spec.ts`; discovery/session and atomic
engine unit suites; Settings restore Storybook interaction. The live pCloud
disaster-recovery contract remains [#291](https://github.com/qwts/photos/issues/291).
