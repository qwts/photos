# ADR-0026: Video & Animated Media

## Status

Accepted 2026-07-20 as the cluster ADR for
[#547](https://github.com/qwts/photos/issues/547) (GIF/WebP),
[#549](https://github.com/qwts/photos/issues/549) (common video and
Apple/iPhone media), and
[#548](https://github.com/qwts/photos/issues/548) (MPEG-TS), proposed and
accepted under the cluster kickoff on #547 (process precedent:
ADR-0022 ↔ #483, ADR-0023 ↔ #534; the owner may veto or amend any section
before its implementing code lands). No clustered issue may weaken this
contract without an ADR amendment — semantics change here first, code second.

This ADR extends [ADR-0005](./ADR-0005-Library-Data-Model.md) (library data
model), [ADR-0006](./ADR-0006-Media-Processing.md) (media processing and the
native-module policy), [ADR-0013](./ADR-0013-App-Lock-Key-Release-And-Protected-Albums.md)
(protected-media custody), and the interoperability contracts in
[ADR-0014](./ADR-0014-Image-Trail-Bidirectional-Interoperability.md) /
[ADR-0015](./ADR-0015-Deterministic-Reviewed-Sync-Journals.md) /
[ADR-0016](./ADR-0016-Isolated-Encrypted-Interop-Transports.md), plus the
[Library Format v1 spec](../Library-Format-v1.md). It rewrites none of them.

Section map: §1–§2 taxonomy and classification (all three issues), §3
playability tiers, §4 custody, §5 playback delivery, §6 posters, §7 playback
UX policy, §8 interoperability, §9 resource bounds, §10 revisit triggers.
#547 implements §1–§4 and §6–§9 for animated images; #549 implements §1–§9
for video and audio; #548 implements the MPEG-TS rows of §2, §3, and §5.

## Context

The library model is stills-only. `FileKind` is
`'jpeg' | 'raw' | 'png' | 'heic' | 'other'`
(`src/shared/library/types.ts`), classification is an extension allowlist
(`src/shared/library/media-files.ts` — its own comment says videos are
"ignored by the scanner"), the lightbox renders a single `<img>`, and the
interop record vocabulary knows `web-bookmark | photo`. Three forces make
video/animated support an architectural decision rather than a feature:

- **A codec surface is a supply-chain surface.** ADR-0006's native-module
  policy deliberately holds the native set to `sharp` + the SQLite driver.
  ffmpeg (or libav bindings) would multiply that surface, drag GPL/LGPL
  questions through the license gate, and duplicate a decoder stack the
  Chromium runtime already ships, sandboxes, and patches.
- **Playability is a property of a device, not of a file.** Libraries move
  between machines (relocation, disaster recovery, Image Trail transfer), and
  HEVC/ProRes decodability differs per platform. Anything persisted into
  library or interop data about "can play" would be a lie on the next device.
- **Custody must not depend on decodability.** The zero-data-loss stance
  means a file Photos cannot render must still be imported, encrypted,
  backed up, restored, exported, and transferred byte-identically — the RAW
  placeholder precedent (ADR-0006), generalized.

Two existing mechanisms make the design cheap: the streaming envelope
(ADR-0004, `src/main/crypto/envelope.ts`) is chunked AES-256-GCM with a
per-chunk nonce counter and AAD-bound chunk index, so bounded random-access
decryption of byte ranges needs no format change; and the privileged
`overlook-full://` protocol already serves decrypted payloads memory-only
with `Cache-Control: no-store`.

## Decision

### §1 Media taxonomy

`FileKind` gains **`gif`, `webp`, `video`, and `audio`**. Containers do not
get kinds: an MP4, a MOV, and a WebM are all `video`, and their container ×
codec facts live in a new probed **media-info record** (zod-validated,
stored as a nullable column per ADR-0005 schema authority in
`migrations.ts`): container brand, video/audio codec identifiers and
profile/bit-depth where safely probed, duration, coded and display
dimensions, rotation, frame-rate summary (including variable-frame-rate
flag), audio presence, HDR/color transfer hints, and — for animated images —
animated flag, frame count, and loop behavior. The enum's duplicate copies
(`shared/ipc/channels.ts`, `main/backup/backup-manifest.ts`) change in the
same commit as `types.ts`; a follow-up may unify them, but divergence is a
defect. `'other'` stays inert. Audio-only files whose signature proves an
audio elementary stream (e.g. bare MP2/MP3) classify as `audio`, never as
`video`.

### §2 Signature-first classification and bounded probes

Content decides; names hint. A shared pure module owns magic-byte
recognition: GIF87a/GIF89a; RIFF/`WEBP` (VP8/VP8L/VP8X, ANIM flag); ISO
BMFF `ftyp`/`moov` brands (MP4/M4V vs QuickTime); EBML with DocType
discrimination (`webm` vs `matroska`); RIFF/`AVI `; MPEG-PS pack header;
MPEG-TS 0x47 sync cadence validated across a packet window (188-byte
packets, `.ts`/`.mts`/`.m2ts` and `video/mp2t` as hints only); MP2/MP3
audio frame sync. A file whose signature contradicts its extension is
classified by signature and keeps its original name and extension untouched
(custody, §4). Signature validation failure means the file is not an import
candidate — exactly today's behavior for non-media.

Container **probing** (stream inventory for the media-info record) is
in-house, pure TypeScript, bounded (§9), and runs off the import hot path in
the existing worker discipline: an ISO-BMFF box walk, an EBML element walk,
TS PAT/PMT parsing, AVI header parsing, and the GIF/WebP animation headers.
No demuxer or decoder dependency is added for probing. **Probe failure on a
signature-valid file is never import failure**: the item imports with a
probe-incomplete media-info state and lands preserved-only until a later
probe pass succeeds.

### §3 Playability tiers, derived per device at runtime

Every `video`/`audio`/animated item resolves on the current device to one of:

- **Playable** — every present stream (video _and_ audio) is locally
  decodable, and the container is one the playback path (§5) can serve.
- **Preserved-only** — validated and fully in custody (§4), but not locally
  decodable/servable. The UI states the limitation honestly; nothing else
  differs.

The derivation is pure shared logic over (media-info record, device
capability set). The capability set comes from the Chromium media stack
(MediaCapabilities/`canPlayType` probed once per codec string per session,
cached) — never from a hardcoded platform table. **Neither the tier nor the
capability set is persisted into library rows, backup manifests, or interop
payloads.** Initial matrix this ADR certifies for fixture coverage, always
subordinate to the runtime probe:

| Container            | Playable v1 (capability-confirmed)                          | Preserved-only v1                                  |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| MP4/M4V (ISO BMFF)   | H.264/AVC + AAC/MP3; HEVC where the platform exposes decode | MPEG-4 Part 2; ALAC and other undecodable audio    |
| QuickTime MOV        | iPhone H.264/HEVC + AAC                                     | ProRes; PCM/ALAC where undecodable                 |
| WebM                 | VP8/VP9/AV1 + Vorbis/Opus                                   | —                                                  |
| MPEG-PS / elementary | —                                                           | MPEG-1/2 video, MP2/MP3 mux                        |
| AVI                  | —                                                           | all (container not servable by the Chromium stack) |
| Matroska `.mkv`      | — (provisional gate, §10)                                   | all                                                |
| MPEG-TS              | H.264 + AAC via the §5 remux adapter (#548)                 | all other stream types                             |
| `audio` kind         | — (v1)                                                      | all                                                |

A mixed case (decodable video, undecodable audio) is preserved-only — Photos
never plays media with silently missing streams.

### §4 Custody: originals are sacred, derivatives are cache

Unchanged principles, restated as binding on the new kinds: original bytes
are immutable and content-addressed through the existing encrypted blob
store; import is transactional (a failed item leaves no partial state);
original filename, extension, MIME, and content hash are preserved verbatim;
**no transcoding, remuxing, or metadata rewriting of originals, ever** —
rotation, variable frame rate, slow-motion timing, HDR/color metadata travel
inside the original bytes and are additionally _recorded_ (not normalized)
in the media-info record. Original export, backup/restore, and protected
media handle the new kinds through the same paths as stills; restored
originals re-probe on their new device (mirroring ADR-0006's verification
stance). Derivatives (posters, §6) remain separate, regenerable, encrypted,
and metadata-stripped; a derivative is never the stored original.

### §5 Playback delivery: the Chromium media stack over range-served envelopes

Playback uses the renderer's `<video>`/`<audio>` element — Chromium's
demuxers, decoders, and sandbox — **not** ffmpeg, not new native decoder
modules (ADR-0006's native set is unchanged by this cluster). Delivery:

- `overlook-full://` gains **HTTP Range semantics for `video`/`audio`
  kinds** (206 responses). The blob store gains a bounded range read that
  decrypts only the envelope chunks covering the requested range (the
  chunked envelope makes offset→chunk mapping exact); plaintext stays
  memory-only, responses stay `Cache-Control: no-store`, and the
  protected-media admit gate is rechecked per request. Whole-file
  decrypt-to-LRU is never used for video — a 4 GB clip must not transit the
  256 MiB image LRU.
- **MPEG-TS** is not servable to `<video>` directly. Its playable rows go
  through a renderer-side **bounded remux adapter** (TS → fragmented MP4 via
  MediaSource), H.264 + AAC only in v1. The adapter is isolated behind an
  interface; the candidate dependency (`mpegts.js`, Apache-2.0) must pass
  the exact-pin and license gates, else the fallback is an in-house
  H.264/AAC-only remuxer. Remuxing is a playback transport detail: it never
  touches stored bytes.
- Animated GIF/WebP need no player: the full viewer serves the **original
  bytes** over `overlook-full://` and Chromium's `<img>` animates them with
  source timing and loop behavior. (Today `FullService` would serve HEIC's
  converted preview for stills — animated kinds must bypass any conversion.)

### §6 Posters: deterministic, decode-derived, placeholder otherwise

Grids and multi-item surfaces always show a **static poster** through the
existing derivative chain (512/2048 WebP, sRGB, metadata-stripped,
ADR-0006 sizes unchanged):

- **GIF/WebP:** sharp decodes page/frame 0 — no new dependency.
- **Video:** a dedicated **poster capture service** — one hidden offscreen
  renderer window behind a main-process adapter, single capture at a time,
  wall-clock/pixel caps (§9) — seeks to presentation time zero, captures the
  first decodable frame, and feeds it to the sharp chain. Capture runs as
  post-import background work (RAW-repair precedent); items show the
  placeholder tile until their poster exists.
- **Preserved-only / probe-incomplete / `audio`:** the placeholder tile with
  kind-appropriate iconography (ADR-0006's RAW fallback, generalized).
  Placeholder is a success state, never a failed import.

Determinism means: same original bytes on the same device and decoder
version yield the same poster frame choice (first decodable frame at t=0);
posters regenerate freely because derivatives are cache.

### §7 Playback UX policy

- **Video never autoplays. Anywhere.** Grids are posters only; the full
  viewer requires an intentional play action. Standard controls: play/pause,
  seek, mute, volume, elapsed/duration, caption/track selection when the
  container carries tracks, and actionable error states — all keyboard
  accessible and within the a11y budgets.
- **Animated GIF/WebP** autoplay only in the single-item full viewer.
  Under `prefers-reduced-motion` they open as the static poster with an
  explicit play affordance. Grids never animate.
- **Preserved-only UI is honest:** the viewer shows the poster or
  placeholder plus a plain statement of why playback is unavailable on this
  device; every custody action (export, backup, transfer, download) remains
  available and visibly so.
- Machine-formatted probe data surfaced in the Inspector (codecs, duration,
  dimensions, frame rate) renders with `.mono-data` per the token contract.

### §8 Interoperability: additive within contract v1

The Image Trail contract stays at v1 (the v2 boundary is separately parked):
the shared record schema gains an **optional media block** — media kind plus
the media-info record and original MIME/extension — attached to the existing
`photo` record kind. Absence means still image; peers that predate the block
ignore it losslessly. Transfers preserve original bytes, hash, MIME,
extension, and the probed metadata with no drift in either direction
(mirrored by image-trail#677/#678/#679). Playability tiers never cross the
wire (§3). **Live Photo pairing is explicitly deferred**: photo and MOV
companions import and transfer as independent items; pairing semantics are a
future story gated on an amendment to this ADR.

### §9 Resource bounds for untrusted media

All limits fail transactionally (no partial library state) with actionable
per-item statuses:

- **Probes** read bounded byte windows (head and tail — QuickTime `moov`
  commonly trails) with a fixed total byte budget and box/element/packet
  count caps; a budget miss yields probe-incomplete, not import failure (§2).
- **Poster capture** has wall-clock, dimension, and memory caps; a capture
  that misses its budget is killed and the item keeps the placeholder.
- **Playback** is bounded by Chromium's sandbox plus range-request size
  caps in the protocol handler; the remux adapter (§5) enforces its own
  byte/time budgets and surfaces overruns as playback errors, never hangs.
- Decompression-heavy animated images pass through sharp's existing
  worker-pool guards; frame/page limits are enforced before decode.
- Exact budget numbers are implementation constants ratcheted by tests, not
  ADR text; changing a _policy_ here (e.g. lifting transactionality) is an
  amendment.

### §10 Revisit triggers

- **MKV** leaves the provisional gate only after a dependency, packaging,
  size, and platform review — amendment required to claim playable rows.
- **`audio` playback** (trivially reachable via `<audio>`) is deferred until
  an audio UX exists; flipping it is an amendment to §3's matrix.
- **Native/platform decode for ProRes or other preserved-only codecs**
  (e.g. an AVFoundation bridge like the HEIC precedent) would extend §5 and
  the native-module set: amendment first.
- **HLS/DASH, live streams, DRM, editing/transcoding features** remain out
  of scope of this ADR entirely.

## Consequences

- Adding a codec or container becomes a data question (signature + probe +
  matrix row + fixtures), not an architecture question — until it needs a
  decoder, which is always an amendment.
- The no-ffmpeg stance keeps the native set and license surface flat at the
  price of preserved-only status for MPEG-1/2, MPEG-4 Part 2, ProRes, AVI,
  and MKV in v1 — stated honestly in the UI, and revisitable per §10.
- Runtime-derived playability means a library never records lies about
  another device, but also means the same item can be playable on one
  machine and preserved-only on another; support copy must say "on this
  device".
- Range-serving over the chunked envelope adds a decrypt path whose
  correctness (chunk-boundary math, auth on partial reads, admit-gate
  rechecks) needs dedicated tests before any playback UI lands.
- Four duplicate kind enums must move in lockstep per §1; the implementing
  PRs inherit that fragility until a unification lands.
- The fixture matrix (supported / preserved-only / malformed / spoofed /
  truncated / over-budget, with recorded hashes) becomes part of the
  contract: a matrix row without a fixture is not a supported claim.
