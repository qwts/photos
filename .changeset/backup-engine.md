---
'photos': minor
---

Backup engine (#105, ADR-0007): the ledger's dirty set flows to the provider
as a resumable queue — ciphertext uploads byte-for-byte (encrypt-once), an
encrypted manifest generation seals per batch (N=2 retained), transient
failures retry with exponential backoff while auth/quota stop the run, the
bandwidth throttle rests proportionally between items, the Wi-Fi-only gate
skips metered networks ('unknown' proceeds as the recorded heuristic), and
auto-backup-on-import subscribes to the import events. New `backup:run`
channel and `backup:progress` events for #108's UI.
