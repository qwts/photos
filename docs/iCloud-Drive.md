# iCloud Drive provider

Issue [#278](https://github.com/qwts/photos/issues/278) delivers iCloud Drive as
a macOS-only encrypted backup and offload provider. This page records the
native, provider, runtime, and live-acceptance contract delivered by #656–#659.
The contract matrix is the canonical readiness record.

## Container identity

- Bundle ID: `com.zts1.overlook`
- Team ID: `Z5DM34QS5U`
- Application ID: `Z5DM34QS5U.com.zts1.overlook`
- iCloud Documents container: `iCloud.com.zts1.overlook`
- signed ubiquity-container entitlement: `Z5DM34QS5U.iCloud.com.zts1.overlook`

The container must be created and attached to the app identifier in Apple
Developer before a matching Developer ID provisioning profile is generated.
Profiles and Apple Account material remain outside the repository.

The provisioned package path requires all of these profile and main-executable
entitlements:

- `com.apple.application-identifier`
- `com.apple.developer.team-identifier`
- `com.apple.developer.icloud-container-identifiers`
- `com.apple.developer.ubiquity-container-identifiers` containing the Team-ID-prefixed container
- `com.apple.developer.icloud-services` containing `CloudDocuments`

Renderer and other helper executables inherit only Electron hardened-runtime
allowances. They must not receive the application identity or iCloud container
entitlements.

## Native boundary

The macOS native binding obtains the container with
`FileManager.url(forUbiquityContainerIdentifier:)`; no JavaScript or native
code derives a `Mobile Documents` path. All caller paths are relative to the
container's `Documents` directory and reject absolute paths, empty segments,
`.` and `..`.

The binding exposes only the operations needed by the provider adapter:

- signed/entitled/account availability with an opaque account token;
- conflict-safe coordinated replacement from a local encrypted file;
- placeholder download followed by coordinated materialization to a local
  encrypted file;
- sorted, metadata-backed, cursor-paginated listing;
- coordinated idempotent deletion.

Every operation revalidates the code signature, entitlement, iCloud account,
and account token. Account changes, offline errors, delayed materialization,
unresolved versions, missing objects, and I/O failures cross the boundary only
as stable fail-closed reason codes.

## Provider contract

The `icloud-drive` adapter owns `Overlook/<library-id>/` and exposes only
provider-relative paths to the backup and restore engines. It stages encrypted
streams in private temporary files for coordinated replacement, materializes
every download through the native boundary, and computes SHA-256 from the
materialized remote bytes. Local write completion alone never counts as remote
verification.

The capability descriptor is intentionally conservative:

- macOS only;
- quota unknown (`usedBytes` and `totalBytes` remain undisclosed to UI);
- download-hash verification;
- no resumable upload; and
- no app-owned interactive authentication or reconnect flow because Apple
  Account custody remains in macOS.

An authority instance pins the opaque Apple Account token shared by all of its
library scopes. A changed or unavailable account expires that authority instead
of allowing an existing provider to read a different account. Library discovery
advertises only a conflict-free `recovery/bootstrap.ovrb` whose remote bytes can
be materialized and hashed.

The deterministic local authority models pagination, placeholder delay,
offline/account changes, conflicts, interrupted committed replacements,
cancellation, and process restart. It runs the shared object, restore, and
complete fresh-profile disaster-recovery contracts in CI. The production
runtime uses the same adapter and shared contract implementations.

## Build and smoke verification

Validate a profile before packaging:

```sh
OVERLOOK_MAC_PROVISIONING_PROFILE=/path/to/profile \
  node scripts/package-signed-provisioned.mjs --validate-only
```

Build the provisioned artifact with `npm run package:signed:provisioned`. The
packaged verifier rejects missing or mismatched iCloud entitlements and rejects
helpers that claim them.

On a signed artifact running under a macOS user signed in to iCloud Drive, run
the focused scratch-object smoke:

```sh
npm run test:icloud:native-smoke -- /path/to/Overlook.app
```

The smoke creates a unique object under `Overlook/.native-smoke/`, coordinates
replacement, lists it, materializes and byte-compares it, deletes it, and exits
nonzero on any failure. Cleanup is attempted even after a partial failure.

Run the complete signed live contract on the same artifact:

```sh
npm run test:icloud:live -- /path/to/Overlook.app
```

The command first revalidates the embedded profile, Team/application/container
identity, main-process entitlements, helper isolation, and signature. The
packaged app then uses four unique library ULIDs to run the exact shared object,
restore-provider, and fresh-profile disaster-recovery contracts plus
page-size-one listing, replacement, File Provider materialization, and SHA-256
verification. It deletes only those scratch homes and writes redacted evidence
to `test-results/icloud-live-contract-evidence.json`. Existing Overlook homes
are permitted and are never selected or deleted. See
[iCloud Drive acceptance](./acceptance/Manual-Test-iCloud-Drive.md).

Unsigned, profile-free, non-macOS, unentitled, or signed-out builds remain
unavailable. The normal profile-free release remains launchable and continues
to use password/recovery-key fallback for app lock.
