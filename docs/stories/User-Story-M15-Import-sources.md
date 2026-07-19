# User Story — M15 Import sources

Epic [#237](https://github.com/qwts/photos/issues/237): SD card / Local
folder / Dropped source picker, window drag-and-drop, Move restricted to
removable volumes at UI and pipeline layers. Coverage: ledger
`m15-import-sources-picker-and-drop` (import-flow e2e + ImportDialog
stories).

## Google Drive selected-file import

Issue [#465](https://github.com/qwts/photos/issues/465) adds Google Drive as
a fourth Import source. It uses Google's desktop Picker in the system browser,
returns only the explicitly selected file IDs over the nonce-bound loopback
callback, downloads supported media into private temporary staging, and then
uses the existing dedupe, encryption, metadata, thumbnail, journal, and
auto-backup pipeline.

- Authorization is ephemeral and remains limited to `drive.file`; it neither
  reads nor replaces the configured Google Drive backup account/token.
- Imports are copy-only. Overlook never deletes the selected Drive files.
- Multiple files are supported; unsupported or unavailable selections are
  counted and skipped. Recursive whole-folder import is out of scope.
- Closing or replacing a selection discards its staging; startup removes
  abandoned staging from an interrupted prior run.
- Packaged builds embed the public Desktop OAuth client ID through
  `OVERLOOK_GOOGLE_DRIVE_CLIENT_ID`. An unconfigured build reports the source
  as unavailable without starting authorization.

Coverage: ledger `m15-google-drive-selected-file-import` (import-flow e2e,
ImportDialog story, OAuth/source/service unit tests, plus owner-run live Picker
verification).
