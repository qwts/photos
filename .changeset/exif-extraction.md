---
'photos': minor
---

EXIF extraction for the import pipeline: exifr (pure JS per ADR-0006) behind
a pure module producing the Inspector's field set — camera (make+model,
deduped), lens, ISO, aperture and shutter formatted like the mock, focal
length, dimensions, taken-at, GPS coordinates per the ADR privacy stance.
RAF files resolve their embedded JPEG via the documented header offsets;
missing or corrupt metadata degrades to an all-null record — never an
exception, never a fabricated value.
