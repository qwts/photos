---
'photos': minor
---

Encrypted blob store: content-addressed originals and thumbnails under the
library layout — every byte streams through the AES-256-GCM envelope before
touching disk (staging included), writes land by fsync + atomic rename,
reads decrypt by key id, and a verify walk re-checks every auth tag plus the
content address. Orphan scanning backs the future repair story.
