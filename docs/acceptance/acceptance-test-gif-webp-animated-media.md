# Acceptance Test: GIF and WebP Animated Media

Issues: [#547](https://github.com/qwts/photos/issues/547)
Contract: [ADR-0026](../adr/ADR-0026-Video-And-Animated-Media.md) §1–§2, §4–§7

## Purpose

Verify that GIF and WebP import as first-class media, grids stay static,
the full viewer plays source animation, reduced-motion users get an
intentional play action, and originals survive export/backup byte-identically.
Complements the automated signature/probe, import, manifest, and Storybook
coverage.

## Setup

1. Copy `tests/fixtures/animated/animated.gif`, `animated.webp`, and
   `static.webp` into a scratch folder, adding one JPEG renamed to `fake.gif`
   and one truncated GIF (first ~24 bytes of `animated.gif`).
2. Note each file's SHA-256 (`shasum -a 256 <file>`;
   `tests/fixtures/animated/provenance.json` records the fixture hashes).

## Import and classification

1. Import the folder. Confirm all five files import; none are skipped.
2. In the Inspector, confirm `animated.gif` / `animated.webp` / `static.webp`
   report their real formats, and `fake.gif` reports JPEG (signature wins)
   while keeping its `fake.gif` filename.
3. Confirm the truncated GIF imports as a placeholder tile with an honest
   preview-unavailable state — never a failed or missing item.

## Grid posters and full-view animation

1. Confirm library-grid tiles for animated media are static posters (first
   frame) — nothing animates in any multi-item surface.
2. Open `animated.gif` in full view with reduced motion OFF. Confirm the
   animation plays with source timing and loops forever.
3. Confirm `static.webp` renders as an ordinary still image.

## Reduced motion

1. Enable "Reduce motion" in System Settings → Accessibility.
2. Open `animated.webp` in full view. Confirm the static poster shows with an
   always-visible "Play animation" button (no hover chrome required); the
   animation starts only after activating it, and "Show static poster"
   returns to the poster. Verify both by keyboard alone.
3. Page to the next item and back. Confirm the poster state returned (consent
   does not persist across items).
4. Repeat inside a protected album.

## Custody

1. Export Originals for all imported items. Confirm exported hashes equal the
   source hashes (no flattening, no re-encode).
2. Export as JPEG. Confirm animated sources yield a still first-frame JPEG.
3. Run a backup, restore into a fresh library, and confirm the animated items
   restore with matching hashes and still animate in full view.
