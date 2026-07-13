---
'photos': minor
---

JPEG transcode export (#98): `format: jpeg` produces universally-openable
files via sharp at quality 90 — RAW sources transcode from their embedded
preview (v1 policy) with the preview-capped count surfaced in the summary,
filenames re-extension to .jpg under the same collision policy, and
metadata is STRIPPED on transcode per ADR-0006's privacy stance (camera
identity and GPS travel only when exporting originals).
