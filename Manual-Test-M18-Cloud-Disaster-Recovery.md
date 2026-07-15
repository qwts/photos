# Manual Test — M18 Cloud Disaster Recovery

Use this owner-only procedure to validate pCloud without putting credentials in
CI or touching a real backup.

## Automated live contract

Prerequisites:

- checkout the PR/commit under test, run `nvm use`, and install with `npm ci`;
- be able to sign in to the intended pCloud test account in a browser; and
- allow a loopback callback on `127.0.0.1`.

Run:

```sh
npm run test:pcloud:live
```

Open the printed OAuth URL and approve access. The test prints its exact
isolated home, `/Overlook/<unique-ulid>`, then runs the shared object and
fresh-profile disaster-recovery contracts.

Expected evidence:

- OAuth token captured with the selected regional API host;
- two synthetic encrypted photos, bootstrap, and manifest upload and verify;
- browser-scope discovery of only that completed recovery home;
- fresh-directory restore with exact metadata, favorite, album membership,
  originals, and thumbnails;
- quota and unsafe-path behavior; and
- one passing test plus successful deletion of every file the run uploaded.

The token exists only in the test process. The test never selects an existing
library ID and never deletes a real backup. Empty ULID folders can remain
because folder deletion is not part of `StorageProvider`; they contain no test
objects and restore discovery hides them.

If the process is killed before cleanup, use the exact scratch home printed by
that run to inspect/delete only that ULID folder in pCloud. Never remove an
existing product-library folder.

Record the command, commit, API region, duration, pass/fail result, and cleanup
result on the owning issue. Do not record the OAuth URL or token.

## Product cross-machine check

1. On machine A, export the recovery key and finish a pCloud backup. Wait for
   **Backup complete**; the recovery bootstrap and manifest publish after the
   blob batch.
2. On a truly fresh machine/profile B, connect the same pCloud account, choose
   the exported key, enter its password, and discover libraries.
3. Confirm the real library is **Validated** with the expected generation,
   photo count, byte count, and album count. An in-progress blob-only folder
   and an empty contract-scratch folder must not appear.
4. Review and run restore. Confirm completion/relaunch, exact photo/favorite/
   album state, and open at least one original at full resolution.
5. Repeat after cancelling during download; the next run must report resumable
   staged work and must not redownload already verified objects.

If the completed real library says **Wrong key**, compare the recovery-key
fingerprint with machine A. If it says **Corrupt**, capture the library ID and
backup audit log before retrying; do not delete the remote home.
