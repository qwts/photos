# Acceptance Test: MPEG-TS Video Media

Issues: [#548](https://github.com/qwts/photos/issues/548)
Contract: [ADR-0026](../adr/ADR-0026-Video-And-Animated-Media.md) §3–§8

## Purpose

Verify that MPEG-TS (`.ts` / `.mts` / `.m2ts`, `video/mp2t`) imports as a
first-class member of the already-designed `video` media kind: signature-gated
classification, a deterministic first-decodable-frame poster, a duration pill,
non-autoplaying static grids, keyboard-accessible full-viewer playback, and
byte-identical original custody through export/backup/restore/Image Trail.
Complements the automated probe, playability, poster-sequencing, and Storybook
coverage — the offscreen decode and encrypted-TS MediaSource playback exist
only inside the signed package and cannot run headless.

## Setup

1. Copy `tests/fixtures/video/*` (and any owner-supplied `.mts` / `.m2ts`
   originals) into a scratch folder. The committed fixtures cover each case:
   - `supported-h264-aac.ts` — playable H.264/AAC transport stream,
   - `preserved-mpeg2-mp2.ts` — valid TS whose codecs are not remuxable
     (Preserved-only on devices that cannot play it),
   - `spoofed-jpeg.ts` — JPEG bytes behind a `.ts` suffix (signature must win),
   - `truncated-h264-aac.ts` — a real stream cut short,
   - `malformed-no-cadence.ts` — bytes without a valid 188/192 sync cadence.
2. Note each file's SHA-256 (`shasum -a 256 <file>`) before import so custody
   can be checked byte-for-byte after export/backup/restore.

## Import and classification

1. Import the folder. Confirm `supported-h264-aac.ts` and
   `preserved-mpeg2-mp2.ts` import as `video` with container `MPEG-TS` in the
   Inspector; none are silently skipped.
2. Confirm `spoofed-jpeg.ts` is **not** imported as video on the strength of its
   suffix — the unverified bytes are rejected (no video row), since the sniffed
   signature does not confirm a transport stream.
3. Confirm `truncated-h264-aac.ts` and `malformed-no-cadence.ts` surface an
   honest import-error / placeholder state, never a crash and never a silent
   drop.
4. Confirm `preserved-mpeg2-mp2.ts` imports and is preserved (original custody
   intact) even where this device cannot play it — Preserved-only, not an error.

## Grid poster and duration pill

1. Confirm each playable video tile shows a **deterministic** poster (the first
   decodable frame, identical across re-imports of the same bytes) with the
   duration pill. Until the poster is captured, the film-glyph fallback stands
   in — a success state, never "PREVIEW UNAVAILABLE".
2. Confirm nothing autoplays and no tile moves in any multi-item surface,
   including with reduced motion enabled.

## Full-viewer playback

1. Open a playable TS in the full viewer. Confirm playback works via the
   existing video transport (mpegts.js TS→fMP4 remux over MediaSource) and is
   fully operable by keyboard alone (play/pause, scrub, volume, exit).
2. Confirm a Preserved-only TS presents its preserved state in the viewer
   rather than a broken player.
3. Confirm playback never writes decrypted bytes to disk.

## Custody

1. Export Originals for all imported TS items. Confirm exported hashes equal the
   source hashes — original bytes, MIME, extension, and stream metadata are
   preserved with no re-encode or remux written back.
2. Run a backup, restore into a fresh library, and confirm the TS items restore
   with matching hashes and still classify, poster, and play as before.
3. Transfer via Image Trail and confirm the round-tripped bytes are hash
   identical to the source.
