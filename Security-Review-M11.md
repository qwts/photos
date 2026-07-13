# Security Review — M11 (crypto, IPC & plaintext-at-rest)

**Issue:** [#129](https://github.com/qwts/photos/issues/129) · **Epic:** [#46](https://github.com/qwts/photos/issues/46) · **Date:** 2026-07-13

Adversarial review of the three security-critical seams before release readiness,
against the [ADR-0004](ADR-0004-Encryption-And-Key-Management) threat model
(single-user desktop app; protects against device theft / disk imaging, the
backup provider, and other OS users without the keychain session; does **not**
protect against a compromised OS/session or an attacker holding the recovery
phrase). Three independent passes: (1) crypto envelope + keystore, (2) IPC
registry + custom protocol handlers, (3) a plaintext-at-rest sweep across every
disk/log/IPC sink.

## Verdict

**All three seams are sound and well-tested. Zero fix-before-release findings.**
One hardening fix landed with this review (F1); three non-blocking follow-ups are
tracked. The ADR-0004 crypto guarantee is upheld across every reachable sink.

| Seam | Verdict | Fix-before-release | Follow-ups |
| --- | --- | --- | --- |
| Crypto (envelope + keystore) | Sound | none | [#229](https://github.com/qwts/photos/issues/229) |
| IPC registry + protocols | Sound | none | [#230](https://github.com/qwts/photos/issues/230), [#231](https://github.com/qwts/photos/issues/231) |
| Plaintext at rest | No leaks | none | F1 (fixed here) |

## 1. Crypto — envelope & keystore

Files: `src/main/crypto/envelope.ts`, `src/main/crypto/keystore.ts`, dev-keystore
wiring in `src/main/index.ts`.

- **AAD completeness — sound.** Every chunk binds `photoId + keyId + chunkIndex +
  flags + totalChunks`. Chunk reorder/drop-middle (monotonic decrypt index vs
  AAD index), cross-photo / cross-key substitution (photoId + keyId in AAD, keyId
  also selects the key), truncation (drop-final → `finalSeen` never set → "truncated
  envelope" on flush), and post-final extension (`if (finalSeen) throw`) all fail
  closed. The header (magic/version/keyId/nonce-prefix) carries no MAC but is
  effectively authenticated — tampering the keyId or nonce prefix fails the chunk-0
  GCM tag.
- **Truncation / length lies — sound.** Over-large chunk length rejected before
  buffering; over-declared length waits and then trips the flush truncation guard;
  under-declared / boundary over-read fails the GCM tag. Buffering is bounded
  (~8 MiB). **No unverified-plaintext release** — each whole chunk is authenticated
  by `decipher.final()` before any bytes are pushed (the classic streaming-GCM
  pitfall is avoided).
- **Key custody — sound.** `safeStorage` unavailable → `KeyCustodyError`, **no
  plaintext fallback**; decrypt throwing or returning garbage → loud error (32-byte
  length check + GCM unwrap tag). Errors reference key **ids**, never key bytes.
  Dev keystore is gated `OVERLOOK_INSECURE_KEYSTORE === '1' && !app.isPackaged` and
  logs loudly — unreachable in a packaged build.
- **Tamper response — sound.** Every failure throws `EnvelopeError` /
  `KeyCustodyError`; no path silently emits wrong plaintext.
- **Follow-up ([#229](https://github.com/qwts/photos/issues/229)) — nonce prefix.**
  The 64-bit random per-blob nonce prefix makes uniqueness a birthday bound
  (negligible at realistic volumes, mitigated by rotation) rather than an enforced
  invariant. Accepted for v0.x; see the
  [ADR-0004 accepted-deviations appendix](ADR-0004-Encryption-And-Key-Management#accepted-deviations--review-notes).
  Informational: first-run `safeStorage.encryptString` sits outside the custody
  try/catch (still fails closed, inconsistent error type); DB key pinned to KEY #1.

## 2. IPC registry & custom protocols

Files: `src/main/ipc.ts`, `src/shared/ipc/registry.ts`, `src/shared/ipc/channels.ts`,
`src/main/protocol-privileges.ts`, `src/main/thumbs/thumb-protocol.ts`,
`src/main/full-protocol.ts`, URL parsers in `src/shared/library/`, `src/preload/index.ts`.

- **Channel validation — sound.** All 33 `ipcMain.handle` calls route through
  `wrapHandler`; **both** request (`channel.request.parse`) and response
  (`channel.response.parse`) are validated, in main and mirrored in the renderer
  invoker. No handler reads a raw request field. No `ipcMain.on` fire-and-forget
  handlers.
- **Forged-id / path traversal — refuted.** The renderer-supplied photo id from an
  `overlook-thumb://` / `overlook-full://` URL **never reaches a filesystem path**.
  URL parsers require `host === 'library'` and exactly one path segment; `standard:
  true` normalizes `..` before parsing. The id resolves via a **parameterized** DB
  lookup (forged id → `undefined` → 404). The on-disk path is derived solely from
  the DB-owned `contentHash`, hex-gated by `assertHash` (`/^[0-9a-f]{64}$/`) at every
  read entry point — a `../`, absolute, or non-hex value can never form a path.
  Defense in depth: the URL photoId is fed as AAD, so a hash/id mismatch also fails
  the AEAD tag.
- **Privilege scope — sound.** thumb: `standard, stream, supportFetchAPI`; full:
  `+ corsEnabled`. No `bypassCSP`, `allowServiceWorkers`, or `secure`. `corsEnabled`
  on full is justified by the fetch-based lightbox; full-res sets `Cache-Control:
  no-store` so Chromium never disk-caches plaintext.
- **Preload surface — sound.** A single frozen `overlook` object of
  `createInvoker`/`createSubscriber` closures; `ipcRenderer` is captured privately
  and never exposed. `nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`.
- **Error leakage — protocol sound; IPC follow-up
  ([#230](https://github.com/qwts/photos/issues/230)).** Protocol responses are
  status-only (no error bodies). IPC has no central error scrubber — today's thrown
  messages are benign, but a future handler could leak a path/secret via
  `error.message`. Tracked, non-blocking.
- **Follow-up ([#231](https://github.com/qwts/photos/issues/231)) — least-privilege
  polish.** Drop unused `supportFetchAPI` from the thumb scheme; optionally gate the
  thumb loader on `deletedAt`/`syncState` for parity with full-res. Neither is a
  boundary crossing under the threat model.

## 3. Plaintext at rest

Full sweep of main + shared for any durable/observable plaintext sink.

- **No fix-before-release plaintext leaks.** Import staging (`blob-store` `put`)
  holds **ciphertext only** (content hash computed in-memory, never written);
  restore/rehydrate temp files hold raw downloaded **ciphertext**; backup upload and
  manifest sealing never decrypt; offload only deletes. The one intentional decrypt
  (export) streams to the **user-chosen directory** with `flags: 'wx'` and removes
  the partial file on any failure — no temp-dir hop.
- **Logs / audit — clean.** `backup-audit.log` and `console.error` crash lines carry
  ids, statuses, byte counts, filenames, and **ciphertext** SHA-256 only — no key
  material, no EXIF, no decrypted bytes.
- **IPC channels carry no image bytes.** Decrypted thumb/full bytes travel only over
  the streaming protocols (memory-only `ByteLru`, no fs; full-res `no-store`).
- **DB / keystore at rest.** SQLCipher raw-key pragma (WAL encrypted); master key
  persisted only via `safeStorage`; `keys.json` holds GCM-wrapped keys; unwrapped
  keys live only in an in-memory map. No clipboard usage. `sharp` strips
  metadata/GPS from thumbnails before re-encryption.
- **F1 (fixed with this review) — harness env hooks now packaged-gated.** The
  fixture/seed/fault env hooks (`OVERLOOK_SEED`, `OVERLOOK_SEED_SYNTHETIC`,
  `OVERLOOK_IMPORT_SOURCE`, `OVERLOOK_EXPORT_DESTINATION`, `OVERLOOK_BACKUP_FAULT`,
  `OVERLOOK_USER_DATA`) were not `!app.isPackaged`-gated, unlike the insecure
  keystore. Not a plaintext leak (the seed writes through the real envelope path),
  but it left a packaged build steerable via env. Fixed: a single `harnessEnv()`
  accessor returns `undefined` in packaged builds, and the import-source fixture is
  now injected from the composition root through the same gate (the service stays
  electron-free). Genuine runtime tuning (`OVERLOOK_FULL_CACHE_MB`) is not a harness
  hook and is intentionally left ungated. Covered by unit tests in
  `tests/import/import-service.test.ts`.

## Follow-ups (all non-blocking)

- [#229](https://github.com/qwts/photos/issues/229) — enforce a per-key blob budget
  or widen the nonce fixed field before large libraries.
- [#230](https://github.com/qwts/photos/issues/230) — central IPC error scrubber
  (opaque codes to the renderer).
- [#231](https://github.com/qwts/photos/issues/231) — protocol least-privilege polish.

## Method

Three independent adversarial passes, each instructed to return findings with
severity / `file:line` / scenario / fix **and** to list the clean seams it verified
(so absence of a finding is evidence, not silence). Findings were synthesized,
de-duplicated, and triaged against the ADR-0004 threat model; only F1 warranted a
code change for release, recorded here and in the ADR appendix.
