# M21 — Image Trail interoperability

Epic: [#283](https://github.com/qwts/photos/issues/283)  
Companion: [Image Trail #560](https://github.com/qwts/image-trail/issues/560)  
Architecture: [ADR-0014](ADR-0014-Image-Trail-Bidirectional-Interoperability)

## Outcome

Overlook and Image Trail can eventually Move or Sync records through one
encrypted, provider-neutral protocol without exposing either native database,
weakening key custody, or deleting a source before verified target durability.

## Delivery slices

- [#331](https://github.com/qwts/photos/issues/331): canonical contract and
  password-protected pairing.
- [#332](https://github.com/qwts/photos/issues/332): translation, persistence,
  legacy compatibility import, and exact round-trip metadata.
- [#333](https://github.com/qwts/photos/issues/333): Move journals and durability
  acknowledgements.
- [#334](https://github.com/qwts/photos/issues/334): Sync revisions, conflicts,
  and reviewed deletion.
- [#335](https://github.com/qwts/photos/issues/335): pCloud, Google Drive, and
  iCloud transport adapters.
- [#336](https://github.com/qwts/photos/issues/336): review, progress, conflict,
  and recovery UI.
- [#337](https://github.com/qwts/photos/issues/337): cross-product acceptance,
  security, interruption, and failure testing.

## Translation acceptance — #332

1. A valid `image-trail.records` v1 bookmark export imports deterministically;
   malformed rows are reported and skipped, while envelope or count mismatch
   fails the file.
2. A password-encrypted `IMAGE-TRAIL-EXPORT` v1 bookmark or mixed full backup
   decrypts only with the exact Image Trail PBKDF2/AES-GCM parameters. Wrong
   password, corruption, weak parameters, or malformed base64 return the same
   failure class.
3. A legacy bookmark persists in the interop table with stable identity,
   origin, URL, dimensions, distinct timestamps, source compatibility,
   protected-pin metadata, and unknown future fields. It does not create a
   native photo row merely because metadata or an external blob id exists.
4. `bookmarkedAt` is never copied to `capturedAt` or `takenAt`; camera EXIF,
   location, and capture facts are never invented.
5. Legacy original and thumbnail references remain honest
   metadata-only/unavailable records until transport verifies bytes, content
   hash, and key custody. A canonical available-original hash must match record
   identity.
6. Canonical records and albums round-trip byte-for-value through persistence,
   including product-specific metadata and ordered known memberships.
7. A native or interop content-hash match is reviewed as a duplicate. A
   different interop id claiming the same remote origin is held as an
   unpersisted conflict for #334 rather than overwritten.
8. Passwords, decrypted payload bytes, and imported originals never enter
   renderer state, logs, or persistent temporary files.

## Automated evidence

- `tests/interop/image-trail-compat.test.ts`: plain/encrypted compatibility,
  cryptographic parameters, indistinguishable failures, full-backup albums,
  count validation, and per-row skipping.
- `tests/interop/record-translation.test.ts`: deterministic identities,
  timestamp semantics, metadata/original honesty, unknown-field preservation,
  and album ordering.
- `tests/interop/repository.test.ts`: SQLCipher-backed exact persistence,
  indexes, native-link preservation, and fail-closed hydration.
- `tests/interop/translation-service.test.ts`: main-process persistence,
  duplicate/conflict classification, original-hash integrity, albums, and
  canonical export.

The renderer workflow and packaged-app manual run intentionally wait for #336;
#332 exposes no renderer or preload API.
