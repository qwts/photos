# iCloud Drive acceptance

Owner-only acceptance for the production `icloud-drive` provider. Use a unique
scratch library or an expendable product library; never select or delete an
existing backup while testing.

## Artifact and account prerequisites

- Dispatch the **Package** workflow for the exact release-candidate commit.
- Download and extract its macOS ZIP. Do not test a development build or DMG.
- Confirm the workflow's signing, notarization, provisioning, entitlement,
  helper-isolation, Gatekeeper, and extracted-ZIP launch gates passed.
- On the test Mac, sign in to the intended Apple Account and enable iCloud
  Drive. Do not export, print, or capture the account identity or opaque token.

## Automated signed live contract

From a checkout of the same commit, select the pinned Node version and install
dependencies, then run:

```sh
nvm use
npm ci
OVERLOOK_ICLOUD_ARTIFACT_COMMIT=<workflow-head-sha> \
  npm run test:icloud:live -- /path/to/Overlook.app
```

Expected result:

- the app is accepted as packaged, signed, provisioned, and entitled for
  `Z5DM34QS5U.com.zts1.overlook` and `iCloud.com.zts1.overlook`;
- object upload, replacement, page-size-one listing, materialization, SHA-256
  verification, restore-provider, and fresh-profile disaster-recovery checks
  pass using the shared production contract functions;
- exact metadata, favorite state, album order/membership, originals, and
  regenerated encrypted thumbnails survive recovery; and
- every generated scratch ULID is absent from discovery after cleanup, even
  when unrelated Overlook libraries already exist.

The command writes mode-0600 redacted evidence to
`test-results/icloud-live-contract-evidence.json`. Attach that file and the
Package workflow URL to #659.

## Product acceptance

Use a new expendable library with at least two photos and one album.

1. In Settings, select iCloud Drive. Confirm availability reflects the current
   signed/entitled/account state and backup completes.
2. Verify the backup, then offload one original. Open it at full resolution and
   confirm File Provider materialization restores the exact bytes.
3. Start another backup, then quit immediately after its generation publishes
   while an iCloud operation can still complete or fail. Confirm Overlook exits
   normally with no SIGABRT crash report. Relaunch and confirm iCloud remains
   selected only for the same Apple Account authority, the published generation
   remains usable, and retry reaches a verified state.
4. Go offline during an upload or materialization. Confirm the operation fails
   closed without claiming success; reconnect and confirm retry/resume reaches
   a verified state without duplicate discovery entries.
5. Start another backup and cancel it. Relaunch and retry; committed remote
   objects may be reused only after verification.
6. Switch Apple Accounts while Overlook is closed, then relaunch. Confirm the
   provider reports disconnected/unavailable and performs no read or mutation
   until explicitly reconnected.
7. In a fresh Overlook profile, use the recovery key to discover and restore
   the scratch library. Confirm photo count, metadata, favorites, album order
   and membership, originals, and thumbnails exactly match.
8. Try a wrong recovery key and a deliberately corrupted expendable object.
   Confirm **Wrong key** and **Corrupt** remain distinct fail-closed outcomes;
   do not alter a real backup for this check.
9. Delete only the expendable library's remote objects and confirm it is no
   longer discoverable. Existing libraries must remain unchanged.

## Evidence and privacy

Record:

- Package workflow URL and exact commit;
- executable SHA-256 and signing authority/identifier/Team ID;
- fixed application and iCloud container identifiers;
- start/end time, duration, pass/fail, check names, and cleanup result; and
- product-checklist results, including quit-during-publication, restart,
  offline, account-change, cancellation, restore, wrong-key, and corruption
  outcomes.

Never record Apple Account identity/token, local username, home/container path,
OAuth material, recovery key, encryption key, photo content, or absolute
artifact path.

## Interrupted-run cleanup

The automated run prints only generated ULIDs in its redacted evidence. If it
is interrupted, rerun the command first: cleanup is scoped to the new run and
cannot delete an older scratch home. Inspect and remove an older home only when
its exact ULID is present in that run's evidence. Never bulk-delete `Overlook/`
or an unverified library ID.
