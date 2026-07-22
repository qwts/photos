---
'photos': minor
---

Add MPEG-TS media support (#548), the MPEG-TS rows of ADR-0026 §2/§3/§5. The
`FileKind` enum gains `video` and `audio` (moved in lockstep across its
duplicate copies); `.ts`/`.mts`/`.m2ts` and `video/mp2t` are classified by a
validated 0x47 packet-cadence signature — never the extension — into
`FileKind.video` with container "MPEG-TS". A bounded, dependency-free PAT/PMT
probe records the elementary-stream inventory, audio presence, and a PCR
duration into the extended media-info record; a truncated or hostile stream
degrades to `probeIncomplete` (preserved-only) rather than failing import.
Playability is derived per device at runtime (H.264 + AAC playable via the §5
remux path, everything else preserved-only) and is never persisted into library
rows, backup manifests, or interop payloads.
