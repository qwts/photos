---
'overlook-photos': minor
---

StatusBar: the 26px mono strip per the mock — "N PHOTOS · size" with
thousands separators on the left; the right side flips between the amber
spinning "ENCRYPTING n → PCLOUD" while photos are pending and the green
"ALL BACKED UP · <relative>" otherwise (driven by ledger events; the engine
itself is M08), plus the permanent AES-256 lock. A shared relative-time
formatter (JUST NOW / 5M AGO / 2H AGO / 3D AGO) ships unit-tested for M08's
real backup stamps.
