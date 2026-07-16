# Acceptance Test: Provider-Neutral Interop Transports

Issues: [#335](https://github.com/qwts/photos/issues/335) and
[qwts/image-trail#588](https://github.com/qwts/image-trail/issues/588)

1. Transfer multi-chunk encrypted bytes, interrupt, and retry. Verified chunks
   are reused and the completed bytes match the manifest SHA-256 exactly.
2. Corrupt a chunk, manifest, or scope identity. Completion fails closed and no
   target durability acknowledgement can consume the result.
3. pCloud and Drive interop objects exist only under `Overlook Interop/v1` with
   the interop owner identity. The narrowed adapter cannot call backup library
   discovery; normal `/Overlook` provider tests remain unchanged.
4. Drive uses resumable upload, paginated list, stale-token invalidation,
   reconnect, quota mapping, server SHA-256, and download-hash fallback.
5. Unsafe paths, offline transport, expired auth, quota, missing object,
   provider unavailable, partial upload, and corrupt verification preserve the
   shared typed failure semantics.
6. The native manifest permits only the released Image Trail origin. Non-macOS,
   unsigned, unentitled, wrong-extension, missing-host, unavailable-account,
   quota, conflict, and malformed requests fail closed.
7. Native control frames remain at most 64 KiB and reject embedded payload
   bytes. Original ciphertext moves by opaque file reference only.
8. Live contracts remain explicitly environment-gated; deterministic pCloud,
   Drive, and iCloud fakes run in CI.

Automated evidence:

- `tests/interop/transport.test.ts`
- `tests/backup/pcloud-provider.test.ts`
- `tests/backup/google-drive-provider.test.ts`
