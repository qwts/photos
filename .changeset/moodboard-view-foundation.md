---
'photos': minor
---

Add a Moodboard library view (first slice of #515). A new fourth library view
joins Grid and List: a pannable, zoomable dot-grid canvas of freeform photo
_placements_ — drag, resize, rotate, layer, group, align/distribute, and a
board-settings panel — built on a pure, process-free board domain
(`src/shared/moodboard`) whose transforms never mutate originals and serialize
byte-stably. Placements are references, so one photo can appear on many boards
and many times on one board. The canvas is a labelled `role="application"` with
a parallel screen-reader reading-order list, a full keyboard map for every
pointer gesture, a single serialized polite live region, and honest
offloaded/unavailable/locked placeholders (locked content never rasterizes).
Persistence, undo, and color-managed export land in follow-up slices.
