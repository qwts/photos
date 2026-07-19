---
'photos': minor
---

Move library… wizard (ADR-0022, #483): the library switcher gains per-row Move actions and multi-select, opening a Review → Progress → Results wizard over the relocation service — collision-safe destination folders under a chosen root, sequential batch moves with the open library last, live item/byte progress, a cancel affordance that changes honestly once a move commits, and results that report exact bytes, unchanged library IDs, and the both-copies cleanup-pending state with a safe retry. A resume banner surfaces committed moves whose source cleanup is still pending after a crash.
