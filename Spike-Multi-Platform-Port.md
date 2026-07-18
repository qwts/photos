# Spike: Multi-Platform Port (iOS, iPadOS, tvOS, visionOS, Android, Windows)

## Status

**Spike — findings only, no decision.** Nothing here is ratified. A port would
supersede [ADR-0003](ADR-0003-Desktop-Stack) (which chose Electron and
explicitly says "a switch would be a new ADR superseding this one") and would
need its own ADR before any code lands.

Investigated 2026-07-18 against `main` at `abbb413`. No production code was
changed by this spike.

## Question

What would it take to run Overlook on iOS, iPadOS, tvOS, visionOS, Android, and
Windows?

## Answer in one paragraph

**Two of the six targets should leave the list immediately, in opposite
directions.** Windows is not a port — it already builds and ships; only code
signing is missing. tvOS is not a port either — it grants ~500 KB of persistent
storage and can never hold a local encrypted library, so it is either cut or
redefined as a cloud viewer. For the remaining four, the cost is **not** the
Electron shell, which is already quarantined behind ~23 adapter files (6% of
`src/`). It is concentrated in four places: `better-sqlite3-multiple-ciphers`,
`sharp`, the macOS-only Objective-C++ addon, and — the only genuinely hard
problem — **master key custody**, which is bound to Electron `safeStorage` and
unreachable from a native app. The on-disk *format* is portable and, for the
database, empirically SQLCipher-4-compatible; roughly half of `src/` is already
platform-neutral TypeScript, and the image pipeline is only seven operations
wide. The renderer's *logic* was already deliberately extracted into
`src/shared/`; its *pixels and gestures* are desktop-web and get rewritten per
platform whatever framework is chosen. And no single framework covers even the
reduced target set — tvOS and visionOS sit outside all of them.

## Method

- Static inventory of `src/main`, `src/renderer`, `src/shared`, `src/preload`,
  `native/`, plus packaging and CI config.
- Line-counted dependency ledger across the whole of `src/`.
- Empirical probe of the SQLCipher on-disk parameters (see
  [Verified: the database is SQLCipher 4](#verified-the-database-is-sqlcipher-4)),
  because the cipher configuration is otherwise unrecorded.
- Review of ADR-0003/0004/0005/0006/0008/0014 for design intent.

## Finding 1 — Windows already ships

Not a port. `.github/workflows/package.yml:31-33` builds a matrix of
`[macos-latest, windows-latest]`, `electron-builder.yml` declares a `win` nsis
target with an icon, and `src/renderer/src/components/TitleBar.tsx` already
branches between the macOS traffic-light inset and custom window controls.
`src/main/crypto/credential-anchor.ts` already has a PowerShell/DPAPI path
beside the macOS `security` path.

The only outstanding Windows work is **code signing**, held on
[#128](https://github.com/qwts/photos/issues/128) pending a certificate.
Windows should be struck from the scope of "port" and tracked as a
release-engineering item.

## Finding 2 — the coupling ledger

Measured over the 41,722 lines of `.ts`/`.tsx` in `src/`:

| Dependency | Files | LOC in those files |
| --- | --- | --- |
| `electron` | 23 | 2,611 (6%) |
| `node:crypto` | 33 | 8,106 |
| `node:path` | 37 | 7,038 |
| `node:fs` | 36 | 5,588 |
| `better-sqlite3-multiple-ciphers` | 16 | 4,481 |
| `node:http` | 2 | 289 |
| `child_process` | 1 | 296 |
| `worker_threads` | 2 | 265 |
| `sharp` | 3 | 221 |
| `exifr` | 1 | 138 |
| **Free of all of the above** | — | **21,485 (51%)** |

Read this carefully: "imports no Electron" is not the same as "portable", and
the LOC column counts whole files, not the coupled lines within them. The
useful signal is the shape — **Electron itself is a thin rind**, and the
23 files that touch it follow a consistent `*-runtime.ts` / `*-factory.ts` /
`*-picker.ts` / `*-protocol.ts` naming convention. `blobs/`, `cache/`, `db/`,
and `interop/` import Electron zero times.

## Finding 3 — the library format is portable

### Verified: the database is SQLCipher 4

`src/main/db/database.ts:29-36` sets only `cipher='sqlcipher'`, a raw 32-byte
hex key, WAL, and foreign keys. Every other cipher parameter rides on library
defaults and is recorded nowhere. Probing a freshly created database through
the pinned `better-sqlite3-multiple-ciphers` (SQLite3 Multiple Ciphers 2.3.5,
SQLite 3.53.2) returns:

| Parameter | Value | Meaning |
| --- | --- | --- |
| `legacy` | 0 | SQLCipher **4** format |
| `legacy_page_size` / `page_size` | 4096 | SQLCipher 4 default |
| `kdf_algorithm` | 2 | PBKDF2-**SHA512** |
| `hmac_algorithm` | 2 | HMAC-**SHA512** |
| `kdf_iter` | 256000 | SQLCipher 4 default (bypassed in raw-key mode) |
| `fast_kdf_iter` | 2 | derives the HMAC key from the raw key + salt |
| `hmac_pgno` | 1 | |
| `hmac_salt_mask` | 0x3a (58) | |
| `plaintext_header_size` | 0 | |

These are exactly the SQLCipher 4 defaults, and the first 16 bytes of the file
are the random salt (confirmed identical to `PRAGMA cipher_salt`). Because the
key is supplied raw, there is no passphrase KDF to replicate.

**Caveat, stated plainly:** this establishes that the *parameters* match
SQLCipher 4 defaults. It does **not** prove byte-for-byte interoperability — no
upstream SQLCipher build was used to open the file. Actually opening a real
`library.db` with `net.zetetic` SQLCipher on iOS and Android is the first
concrete experiment any port should run, and it is cheap.

### The other four formats are self-describing

Every binary artifact carries a magic and a version byte, which is unusually
disciplined and makes reimplementation mechanical:

- **Blob/thumb envelope** (`src/main/crypto/envelope.ts`) — `"OVLK"` ‖ version
  ‖ key id ‖ 8-byte nonce prefix, then 4 MiB AES-256-GCM chunks. The 96-bit
  nonce is a 64-bit per-blob random prefix ‖ 32-bit chunk counter, so no
  cross-blob state is needed. AAD binds photo id, key id, chunk index, flags,
  and total chunks, so truncation and reordering fail the tag check.
- **Key wrap** (`keystore.ts`) — `base64(nonce ‖ tag ‖ ciphertext)`, AES-256-GCM,
  AAD = key id. Wrapped keys live in versioned JSON at `keys.json`.
- **Recovery key** (`recovery.ts`) — a fixed 77-byte file: `"OVRK"` ‖ version ‖
  salt ‖ nonce ‖ ciphertext ‖ tag, header as AAD.
  ([ADR-0008](ADR-0008-Recovery-Key-Format))
- **App-lock record** (`app-lock-credentials.ts`) — `"OVLK"` ‖ UTF-8 JSON naming
  its own scrypt parameters (N=2^17, r=8, p=1) and two GCM slots.

Blobs are content-addressed by SHA-256 of plaintext under a two-level hex
fan-out, so paths are derivable from the database with no separate index, and
`readEnvelopeKeyId` can recover the key id from the first 9 bytes of any blob.

Everything above is AES-256-GCM, PBKDF2, scrypt, and SHA-2 — all available in
CryptoKit and `javax.crypto`/Tink. This is a few hundred lines of Swift, not a
research project.

## Finding 4 — key custody is the one hard problem

This is the finding that decides the shape of the whole project.

`master.key` exists in one of two mutually exclusive forms, distinguished by
sniffing for an `OVLK` prefix (`keystore.ts:126`):

1. **Default (no app lock):** the output of Electron `safeStorage.encryptString`
   — macOS Keychain, Windows DPAPI, libsecret. This is opaque and bound to the
   Electron app's OS identity. **A native iOS or Android app cannot read it.**
   `KeyStore.open` refuses to run without the keychain; there is deliberately no
   plaintext fallback ([ADR-0004](ADR-0004-Encryption-And-Key-Management)).
2. **App lock configured:** the portable, self-describing `OVLK`+JSON record.

So today there are exactly two cross-platform ingresses into a library: the
**recovery key file**, or **having app lock configured**. Both already exist and
both are already specified — which is a much better starting position than it
sounds.

Deepening the problem, `credential-anchor.ts` maintains the app-lock freshness
anchor by *shelling out* to `/usr/bin/security` (line 204), `secret-tool`, or an
embedded PowerShell DPAPI script (lines 164, 283). **Process spawning is
prohibited on iOS, iPadOS, tvOS, and visionOS** — there is no workaround. This
is a rewrite against Keychain/Secure Enclave and Android Keystore directly,
which is cleaner than what desktop does, but it is new code.

A port therefore needs a deliberate custody design. The most likely shape: make
the **portable app-lock record the on-disk source of truth**, and let each
platform cache the derived master key in its own secure enclave as a
convenience. That is an ADR-sized decision, and it is the actual project.

## Finding 5 — the renderer's logic is already extracted; its surface is not

The renderer is ~10,200 lines of TS/TSX plus 3,890 lines of CSS across 29 files,
with 68 exported components and ~93 design tokens.

**What already survives a UI rewrite** — someone was deliberately separating
this, with comments saying so:

- `src/shared/library/app-state.ts` (222 L) — the whole app state shape as a
  pure reducer. A ready-made view model for SwiftUI or Compose.
- `src/shared/library/grid-layout.ts` (127 L) — all virtualization math,
  explicitly "no DOM".
- `src/renderer/src/lightbox/geometry.ts` (106 L) — zoom/pan/rotate transforms,
  DOM-free despite its location. Should move to `src/shared/` on day one.
- The URL contracts, `format.ts`, the ICU message catalog, and the Zod IPC
  contract as a stub-generation source.

**What does not survive, on any target:**

- **56 HTML5 drag-and-drop handlers.** Photo→album drag and OS file-drop-to-import.
  The *payload* is portable (`src/shared/library/photo-drag.ts` is versioned
  JSON behind an interface); the `DataTransfer` transport is not.
- **Zero touch events exist.** No pinch, no pan, no long-press. Lightbox zoom is
  `onWheel` with `DOM_DELTA_LINE` normalization.
- **Hover-revealed affordances.** Three are load-bearing, not cosmetic: the tile
  selection circle (`phototile.css:94`), list-row selection (`list.css:39`), and
  the album action menu (`shell.css:423`). These are invisible and unreachable on
  touch.
- **No keyboard shortcut registry.** `state/use-global-keys.ts` is a 44-line
  inline if-chain, with more key handling scattered across four other files.
  There is no binding table to remap for a tvOS remote.
- **No focus model.** No roving tabindex, no directional navigation, no
  focus-state tokens beyond browser tab order. tvOS needs this from scratch.
- **Desktop-fixed layout.** Chrome dimensions are hardcoded tokens
  (`--titlebar-h: 30px`, `--sidebar-w: 216px`, `--inspector-w: 280px`) composing
  a three-pane frame. Only **5 real responsive breakpoints exist in 3,890 lines
  of CSS**; there is no safe-area or orientation handling anywhere. Density is
  desktop (13px base type, 24–34px controls) — below iOS, Android, and
  especially visionOS touch-target guidance.
- Tokens are **dark-mode only**; there is no light theme yet
  ([#284](https://github.com/qwts/photos/issues/284)).

One real win: there is **no shift-click range select or modifier multi-select**.
Selection is an explicit per-tile toggle button with `aria-pressed`, which maps
cleanly onto touch and TV selection modes.

## Finding 6 — the interop contract is the proven template

The strongest evidence that this is tractable: **the team has already done this
exercise once.** `src/shared/interop/` plus `design/handoff/contracts/v1/`
define a versioned, product-neutral, encrypted, wire-level transfer protocol
that a *different product* (`qwts/image-trail`) with a *different database
format and key hierarchy* implements against
([ADR-0014](ADR-0014-Image-Trail-Bidirectional-Interoperability)).

It ships published draft-2020-12 JSON schemas, seven golden fixtures
(valid/invalid/replay/corrupt/future-version), `SHA256SUMS`, and CI-enforced
cross-product acceptance evidence (`npm run check:interop-acceptance`, 10
required scenarios and 4 manual checks). Pairing is PBKDF2-SHA256 at 600,000
iterations plus AES-256-GCM — deliberately WebCrypto-common-denominator
primitives rather than the scrypt used elsewhere in the app.

This matters twice over:

1. It is the template for how to specify the library format for a second
   implementation. That work has a precedent in this repo, not just a plan.
2. **A mobile app could be modeled as an interop *peer* rather than a second
   implementation of the library format** — a companion that syncs, rather than
   a full port that opens `library.db` directly. That is a dramatically smaller
   and safer first step.

The constraint: `interopProductSchema` is a closed two-value enum
(`['image-trail', 'overlook']`, `contract.ts:6`), the header refines
source ≠ target, and the pairing magic is the literal
`OVERLOOK-IMAGE-TRAIL-PAIRING`. Admitting a third product is a contract-version
bump coordinated with the Image Trail repo — not a blocker, but not free either.

## Finding 7 — the gate suite is part of the cost

Easy to overlook when scoping. The repo's quality regime is
[ADR-0001](ADR-0001-Automation-Check-Governance)-governed and substantial:
~25,000 lines of test code across 140 test files, 29 Storybook stories, and a
Playwright E2E lane in which **all 27 specs are bound to
`playwright._electron`**.

- A web-view port keeps most of this.
- A React Native port loses the E2E lane and the story lane, and keeps the unit
  tests only insofar as the core stays TypeScript.
- A native-core rewrite (Rust/Swift/Kotlin) invalidates the c8 coverage floors,
  the type-coverage floor, and most of the 140 test files — and the floors are
  **ratchets that may only ever rise**. A second language means a second gate
  suite that today's automation does not govern at all. ADR-0003 rejected Tauri
  substantially for this reason; that argument has not weakened.

## Platform-by-platform

| Target | Real status | Dominant cost |
| --- | --- | --- |
| **Windows** | **Already ships.** Needs a signing cert ([#128](https://github.com/qwts/photos/issues/128)). | Release engineering, not porting. |
| **iPadOS** | Most tractable Apple target. Three-pane layout survives; density and gestures do not. | Touch input model, custody. |
| **iOS (phone)** | Shell must become a navigation stack; 5 breakpoints to build on. | Layout redesign + touch + custody + background-execution limits for long imports/backups. |
| **Android** | Comparable to iOS, plus a back-button model that does not exist today, and scoped-storage conflicts with the blob store's hardlink/rename durability. | As iOS, plus storage semantics. |
| **visionOS** | Closest to a "hover exists" model (gaze), so hover-reveals partly survive. Inherits iOS core work. | 24–34px controls are far below spatial-UI guidance. |
| **tvOS** | **Should be cut from scope as specified** — see below. | Not a port at all; a different product. |

### tvOS cannot host a local library — cut or redefine it

This is the one finding that removes work rather than adding it, so it is worth
stating bluntly. Apple's *App Programming Guide for tvOS* specifies that a tvOS
app gets roughly **500 KB of persistent local storage** (via `NSUserDefaults`).
Everything else — including `Caches` — is **purgeable by the system whenever the
app is not running**, and the app bundle is capped at **4 GB**. Persistent data
is expected to live in iCloud/CloudKit or on your own server.

An encrypted local photo library is therefore **architecturally impossible** on
tvOS. No framework choice changes this; it is a platform guarantee we do not
get. The options are:

1. **Cut tvOS.** Recommended for now.
2. **Redefine it as a cloud viewer** — a streaming client against the existing
   backup provider, sharing the crypto and protocol core but essentially none of
   the library-management model. That is a separate product with its own ADR,
   not a port of this one.

Caveat: the authoritative source is **archived** Apple documentation, and much
of the secondary writing about it is stale. Re-confirm against current tvOS
documentation before acting — but plan on the constraint holding, because
multiple independent 2024–2026 sources still describe the same limits.

## Finding 8 — no single framework covers the six targets

Surveyed 2026-07-18. The headline is not which framework is best; it is that
**tvOS and visionOS fall outside every mainstream cross-platform framework**, so
the six-platform ask cannot be satisfied by one technology choice.

| Option | Covers | Does not cover | Notes |
| --- | --- | --- | --- |
| **Electron** (today) | Windows, macOS, Linux | iOS, iPadOS, tvOS, visionOS, Android | Windows already ships. |
| **Tauri v2** (2.11.5, 2026-07-01) | Windows, macOS, Linux, iOS, Android | **tvOS, visionOS** | Stable mobile since v2.0 (2024-10-02). Rust core — the second toolchain [ADR-0003](ADR-0003-Desktop-Stack) rejected. |
| **React Native** | iOS, iPadOS, Android, Windows (RN-Windows) | tvOS and visionOS only via **separate forks** | See below. |
| **`react-native-tvos`** | tvOS, Android TV | — | Community fork, at 0.76.5-0, active through 2026. Not core RN. |
| **`react-native-visionos`** | visionOS | — | Callstack fork, active through 2026. Not core RN. |
| **Compose Multiplatform** (1.11.0, 2026-05) | Android, iOS, desktop | **tvOS, visionOS** | iOS stable since 2025-05; KMP stable since 2023-11. Kotlin core. |
| **Capacitor** | iOS, iPadOS, Android | tvOS, visionOS | Thinnest wrapper; keeps the existing web UI. |
| **Native per platform** | **all six** | — | SwiftUI (iOS/iPadOS/tvOS/visionOS), Compose (Android), existing Electron (Windows). Maximum reuse of the *core*, zero reuse of the UI. |

Two consequences worth internalising:

- **Choosing React Native for Apple platforms means running three React Native
  distributions** — core, `react-native-tvos`, and `react-native-visionos` —
  each a full fork tracking core with lag. That is a standing maintenance tax on
  a one-owner project, and it is the kind of second toolchain ADR-0003 rejected
  Tauri over.
- **Only "native per platform, shared core" reaches all six.** That is also the
  option that most directly contradicts ADR-0003's single-TypeScript-toolchain
  driver, and that invalidates the gate suite described in Finding 7. It is
  nonetheless the architecture used by comparable privacy-first apps with a
  cryptographic core, and it is the one that best fits *this* codebase, because
  the expensive, security-critical, well-specified part (formats, crypto,
  protocol) is exactly the part that would be shared.

This reinforces the sequencing below: the framework question is genuinely
downstream. Specifying the format and solving custody is work that every option
in this table requires, and none of it is wasted whichever is chosen.

## Finding 9 — the image pipeline is seven operations wide

`sharp` looks like a large dependency and is actually a thin one here. There are
**four `sharp()` call sites in the entire codebase**:

- `src/main/export/transcode.ts:37` — `.rotate().jpeg({quality}).toBuffer()`
- `src/main/import/raw-preview.ts:40` — `.metadata()`
- `src/main/import/thumbnail-worker.ts:36` — the resize/webp chain
- `src/main/import/thumbnail-worker.ts:44` — `.metadata()`

Across them the complete API surface is `metadata`, `resize`, `rotate`, `webp`,
`jpeg`, and `toBuffer`. EXIF is isolated to a single file
(`src/main/import/exif.ts`, exifr).

Neither `sharp` nor libvips can run on mobile — sharp is a Node N-API addon with
no JS-runtime equivalent on iOS or Android, and libvips has no supported mobile
build and a heavy glib/gobject dependency graph. But given a seven-operation
surface, **the right move is to reimplement against platform codecs rather than
port an image library**: `CGImageSourceCreateThumbnailAtIndex` (ImageIO) and
`CGImageSourceCopyPropertiesAtIndex` for EXIF on Apple, `ImageDecoder` with
`setTargetSize` plus `androidx.exifinterface` on Android. Both are
hardware-accelerated and stream from disk without a full decode. RAW is better
served natively too — `CIRAWFilter` on Apple covers far more formats than the
current embedded-preview-only policy in [ADR-0006](ADR-0006-Media-Processing);
Android handles only DNG natively and would need LibRaw.

The risk this creates is **derivative divergence**: ADR-0006 pins 512px/2048px
WebP, sRGB conversion honoring embedded ICC, and metadata stripping. Different
decoders will not produce byte-identical output, and blobs are content-addressed
by hash, which interacts with dedup and backup. Decide deliberately whether
derivatives are allowed to differ per platform.

## Finding 10 — if a shared core is chosen, share only the headless part

The only architecture reaching every remaining target is a headless core plus
native UI. The precedents are real and instructive, in both directions:

- **Signal** — `libsignal` is Rust, consumed from Swift on iOS, Kotlin via JNI on
  Android, and **Node via neon** on desktop. That is exactly this project's
  three-way split.
- **Mozilla application-services** — Rust core shared by Firefox iOS and Android,
  and the origin of **UniFFI**, which generates Swift and Kotlin bindings.
- **Matrix** `matrix-rust-sdk` — a sync engine shared into Element iOS/Android.
- **Dropbox — the cautionary tale.** Dropbox shared a C++ core between iOS and
  Android via Djinni, then publicly abandoned it ("The (not so) hidden cost of
  sharing code between iOS and Android", 2019): the overhead of the shared layer
  — bespoke tooling, build systems, hiring, cross-FFI debugging — exceeded the
  duplication it saved.

The rule the successful cases follow: **share what is hard and headless; never
share UI.** Signal and Mozilla share crypto, protocol, and sync. Dropbox tried to
share broad application logic. For Overlook the natural core is
`db/`, `crypto/`, `backup/`, `interop/`, `library/`, plus all of `src/shared/` —
which is also, not coincidentally, the part that is already Electron-free.

Two practical constraints if the core were Rust: `aarch64-apple-tvos` and
`aarch64-apple-visionos` are **Tier 3** Rust targets, meaning no prebuilt `std`
and a nightly `-Z build-std` toolchain, whereas Windows/iOS/Android are Tier 1–2.
C++ is the more boring choice for precisely those two targets. And either way it
is a second toolchain with a second gate suite — the cost ADR-0003 weighed and
rejected. That tradeoff should be re-argued explicitly, not assumed to have
changed.

## Finding 11 — store policy has two real teeth

Both apply to every framework choice equally; they are properties of the product.

- **Encryption export compliance.** Client-side AES-256 over user data is *not*
  covered by the usual exemptions (authentication, signatures, DRM, or merely
  using HTTPS). `ITSAppUsesNonExemptEncryption` must be `true`, with an annual
  BIS self-classification report and an ERN under the standard mass-market
  self-classification path. Not a blocker — a paperwork obligation that must be
  owned before submission. Not legal advice; get it reviewed.
- **iOS backup exclusion is a genuine rejection risk for a photo app.** Under
  guideline 2.5.x and Apple's data storage guidelines, only user-generated
  content belongs in `Documents/` (which is backed up to iCloud); regenerable
  data must be excluded via `isExcludedFromBackupKey`. Overlook's originals and
  database qualify as user data, but **`thumbs/` and `cache/` are regenerable and
  must be excluded** — apps have been rejected for backing up gigabytes of
  derived thumbnails. Note the corollary: `Library/Caches` is purgeable, so the
  thumbnail cache must be regenerable on demand. Worth checking whether the
  current desktop code already assumes derivatives are always present.
- Android's analogue is lighter but real: the Play **Photo and Video Permissions**
  policy pushes apps toward the system Photo Picker and requires justification
  for broad `READ_MEDIA_IMAGES`, and Android 15 caps `dataSync` foreground
  services at roughly six hours a day.

## Finding 12 — long imports and backups do not run in the background on iOS

There is no iOS mechanism for "import and upload a 50,000-photo library while
backgrounded". `beginBackgroundTask` grants seconds; `BGProcessingTask` runs only
when the system chooses, typically idle and charging. The only durable path for
the transfer leg is a **background `URLSession`**, where the system owns
scheduling and wakes the app on completion.

The product consequence: imports become foreground-driven with visible progress,
and **interruption and resumption become first-class states rather than error
paths**. The existing import state machine and the resumable journals in
`src/main/import/` and the interop layer are real assets here — this is a case
where the desktop design already anticipated the shape mobile forces.

## One concrete iOS gotcha

`plaintext_header_size` is `0` in our databases (verified above), meaning the
entire file including the SQLite magic is encrypted. SQLCipher documents a
non-zero plaintext header specifically so that **iOS can recognise the file as a
SQLite database**. If iOS file-protection or backup behaviour turns out to
require it, changing it is a **format change to every existing library**, not a
runtime flag. Decide this before shipping any iOS client, not after.

## What this spike did not answer

Named honestly rather than papered over:

- Whether upstream SQLCipher on iOS/Android actually opens a real `library.db`.
  Parameters match and SQLite3 Multiple Ciphers documents its `sqlcipher` scheme
  as compatible with SQLCipher 1–4, but no upstream build was used to open a
  file. **Cheap to test — do it first.**
- Framework selection. Deliberately left open; it is downstream of the custody
  decision, not upstream of it.
- Whether derivatives can match across decoders (Finding 9), and whether
  per-platform differences are acceptable given content-addressed storage.
- Product scope. "Port" and "interop companion" are very different products, and
  nobody has decided which this is. This is the actual blocking question.
- Effort estimates. None are given here on purpose — they are not knowable before
  the custody design exists and the SQLCipher experiment has run.
- Whether the current desktop code assumes derivatives are always present, which
  iOS's purgeable `Library/Caches` would violate.
- Anything requiring legal review, including export compliance filings.

## Suggested next steps

Ordered by information gained per unit of effort. Steps 1–4 are days and cost
almost nothing; everything after depends on a product decision.

0. **Fix the scope first, because it is free.** Move Windows to a
   release-engineering item under [#128](https://github.com/qwts/photos/issues/128),
   and cut or redefine tvOS. That takes the ask from six platforms to four
   before any engineering happens.
1. **Open `library.db` with upstream SQLCipher** on iOS and Android. One
   afternoon. Settles the largest open technical question.
2. **Decrypt one blob envelope in Swift** against a committed fixture. Proves the
   envelope spec is complete and reimplementable.
3. **Write the library format spec** into the wiki from source, using
   `design/handoff/contracts/v1/` as the template — magic bytes, envelope layout,
   key wrap, recovery file, app-lock record, on-disk tree, and the SQLCipher
   parameters verified above. This is valuable *even if no port ever happens*:
   the format is currently defined only by TypeScript implementation, and a
   backup you cannot decrypt from a second implementation is a backup with a
   single point of failure.
4. **Move `lightbox/geometry.ts` into `src/shared/`** and generate the ~93 design
   tokens from a single source into CSS + TS. This also closes an unenforced
   duplication: `VirtualGrid.tsx:16-19` hardcodes `GRID_GAP = 4` and friends as
   JS constants, with a comment saying they must manually match the CSS tokens.
   They agree today; nothing fails if they stop agreeing.
5. **Decide the product question** — full port versus interop companion — then
   write the custody ADR. Everything else waits on this.
6. Only then choose a UI technology, per platform, with the custody and format
   work already done and shared.

Item 3 deserves emphasis. It is the highest-value item on this list, it is
independent of whether the port is ever approved, and it closes a real
resilience gap in the product today.

## Sources

External claims, checked 2026-07-18. Everything about *this* repo was verified
directly against the working tree at `abbb413`; the SQLCipher parameters were
measured, not read.

- [Tauri 2.0 stable release](https://v2.tauri.app/blog/tauri-20/) — mobile
  support, platform coverage
- [react-native-tvos](https://github.com/react-native-tvos/react-native-tvos) —
  community fork, Apple TV / Android TV
- [react-native-visionos (Callstack)](https://github.com/callstack/react-native-visionos)
- [React Native out-of-tree platforms](https://reactnative.dev/docs/out-of-tree-platforms)
- [Compose Multiplatform 1.11.0](https://blog.jetbrains.com/kotlin/2026/05/compose-multiplatform-1-11-0/)
  and [KMP supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html)
- [SQLite3 Multiple Ciphers — SQLCipher scheme](https://utelle.github.io/SQLite3MultipleCiphers/docs/ciphers/cipher_sqlcipher/)
  — documents compatibility with SQLCipher 1–4 and the `plaintext_header_size`
  rationale for iOS
- [SQLCipher design](https://www.zetetic.net/sqlcipher/design/) — v4 defaults
- [sqlcipher-android](https://github.com/sqlcipher/sqlcipher-android) — note the
  older `android-database-sqlcipher` artifact is deprecated
- [libvips](https://github.com/libvips/libvips) — no supported mobile build
- [App Programming Guide for tvOS](https://developer.apple.com/library/archive/documentation/General/Conceptual/AppleTV_PG/index.html)
  (**archived** — re-confirm) and
  [Apple developer forum thread on tvOS storage purging](https://developer.apple.com/forums/thread/18465)
- [Apple: complying with encryption export regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)
- [Apple Technical Q&A QA1719 — backup exclusion](https://developer.apple.com/library/archive/qa/qa1719/)
- [Background Tasks framework](https://developer.apple.com/documentation/backgroundtasks)
- [Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15)
  — `dataSync` foreground-service cap
- [Dropbox: the (not so) hidden cost of sharing code between iOS and Android](https://dropbox.tech/mobile/the-not-so-hidden-cost-of-sharing-code-between-ios-and-android)
- [libsignal](https://github.com/signalapp/libsignal),
  [Mozilla UniFFI](https://mozilla.github.io/uniffi-rs/),
  [Rust platform support tiers](https://doc.rust-lang.org/rustc/platform-support.html)
