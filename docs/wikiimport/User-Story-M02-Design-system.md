# M02: Design system

**Epic:** [#37](https://github.com/qwts/photos/issues/37) · **Lane:** Lane A — UI

Lane A. Port the Overlook design system — 5 token files (`tokens/`, oklch dark-first colors, IBM Plex Sans/Mono, spacing/radii/chrome dims, elevation/motion) and ~16 components (`components/{core,forms,feedback,media}/`) — into the React renderer, pixel-matched to the specimen cards in `guidelines/`. Icons come from a **pinned Lucide package with the fixed vocabulary** in the DS readme (no CDN — privacy-first; no emoji, no icon fonts).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#54](https://github.com/qwts/photos/issues/54) | Port design tokens + IBM Plex fonts into the renderer | #48 |
| [#55](https://github.com/qwts/photos/issues/55) | Icon component with the fixed Lucide vocabulary (pinned, no CDN) | #48 |
| [#56](https://github.com/qwts/photos/issues/56) | Storybook (react-vite) + interaction tests in CI — closes #11 | #54, #55 |
| [#57](https://github.com/qwts/photos/issues/57) | Core controls: Button, IconButton, Badge, Tooltip | #56 |
| [#58](https://github.com/qwts/photos/issues/58) | TitleBar component on the frameless window | #56, #50 |
| [#59](https://github.com/qwts/photos/issues/59) | Overlay primitives: Dialog and Toast | #57 |
| [#60](https://github.com/qwts/photos/issues/60) | Form controls: SearchField, Chip, Segmented | #57 |
| [#61](https://github.com/qwts/photos/issues/61) | Form controls: Slider, Switch, Checkbox | #57 |
| [#62](https://github.com/qwts/photos/issues/62) | Feedback & media: ProgressBar, StatusGlyph, MetadataRow | #57 |
| [#64](https://github.com/qwts/photos/issues/64) | PhotoTile with full state matrix | #62 |

## Definition of done

See the epic issue [#37](https://github.com/qwts/photos/issues/37) — the epic body is canonical; this page is the planning index entry.
