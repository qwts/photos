---
'photos': minor
---

Relocation hardening (ADR-0022, #483): preflight now classifies the destination volume for real — FAT32 refuses with an actionable message (its 4 GB file cap would truncate large originals) and network mounts are flagged as a warning, never a block (ADR-0017 §5). A new `library-relocation:preflight` dry-run channel powers the wizard's Review step (resolved move method, exact byte requirements vs. free space, network warning, source-lock holder) without taking locks or writing journals. Electron E2E now proves the ADR-0022 §4 crash matrix end to end: killed at every copy/verify/activate/commit boundary, relaunch recovery leaves exactly one authoritative, usable library.
