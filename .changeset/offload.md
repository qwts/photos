---
'photos': minor
---

Offload + rehydrate (#107, ADR-0007): verified-synced originals evict
locally (thumbnails stay — the library browses offline) with a shared-hash
guard, flipping tiles to the offloaded state via targeted pushes; touching
an offloaded photo in the lightbox downloads it back through an atomic
staged restore that decrypt-and-rehash verifies before publishing — a bad
download never becomes local truth and failures surface as a red toast.
Library stats gain the local/cloud byte split, and `backup:offload` /
`backup:rehydrate` channels expose the flows.
