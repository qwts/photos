# iCloud Drive provider

Issue [#278](https://github.com/qwts/photos/issues/278) delivers iCloud Drive as
a macOS-only encrypted backup and offload provider. This page records the
native and signing contract established by
[#656](https://github.com/qwts/photos/issues/656). Provider behavior and live
acceptance remain tracked by #657–#659 until the contract matrix marks the
provider ready.

## Container identity

- Bundle ID: `com.zts1.overlook`
- Team ID: `Z5DM34QS5U`
- Application ID: `Z5DM34QS5U.com.zts1.overlook`
- iCloud Documents container: `iCloud.com.zts1.overlook`

The container must be created and attached to the app identifier in Apple
Developer before a matching Developer ID provisioning profile is generated.
Profiles and Apple Account material remain outside the repository.

The provisioned package path requires all of these profile and main-executable
entitlements:

- `com.apple.application-identifier`
- `com.apple.developer.team-identifier`
- `com.apple.developer.icloud-container-identifiers`
- `com.apple.developer.ubiquity-container-identifiers`
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
as stable fail-closed reason codes. The provider adapter owns remote hashing
and verification in #657.

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
nonzero on any failure. Cleanup is attempted even after a partial failure. This
is a native boundary smoke, not the complete provider/live disaster-recovery
contract owned by #659.

Unsigned, profile-free, non-macOS, unentitled, or signed-out builds remain
unavailable. The normal profile-free release remains launchable and continues
to use password/recovery-key fallback for app lock.
