---
'photos': minor
---

Storage-provider seam (#103, ADR-0007): the typed interface the whole backup
epic builds against (put/getStream/list/delete/quota/verify + auth state,
typed ProviderError kinds), a filesystem-backed mock provider with quota and
connection simulation, a fault-injection wrapper producing every engine
error path (upload failure, verify mismatch, auth expiry, transient
download), and a provider registry whose connection states feed the
settings card. Live pCloud arrives as #109 against the same contract suite.
