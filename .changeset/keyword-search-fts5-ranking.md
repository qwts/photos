---
'photos': minor
---

Library search now runs on the FTS5 index (`photos_fts`) instead of a plain substring scan: prefix-matched per word and ranked by bm25, overriding the grid's date/name/size sort while a search is active. A query with no tokenizable content (pure punctuation/whitespace) falls back to the previous substring match. Startup maintenance also verifies the search index's integrity and rebuilds it if it's drifted from the photos table.
