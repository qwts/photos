---
'photos': minor
---

Multi-library registry and per-library key management (ADR-0017, #384): the library path is now resolved through a standalone `libraries.json` registry (existing installs are registered in place with no data movement), each created library provisions its own master key and KEY #1 in its own directory, and new `library-registry:*` IPC channels expose list/create/open/remove/current to the renderer. Removing a library from the registry never touches its data or keys.
