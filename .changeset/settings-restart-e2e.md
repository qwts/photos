---
'photos': minor
---

E2E (#116): settings persist across a real app restart — run one changes sort/Wi-Fi/bandwidth and disconnects the provider, run two proves the store reports them, the grid renders in the persisted order unprompted, the dialog re-renders the disconnected state, and manual backup stays blocked. Also fixes a toast race the suite surfaced: an automatic backup's green "BACKUP COMPLETE" was replacing the import-complete toast — auto successes are now quiet (the status bar still flips); manual runs keep the toast and failures stay loud for every trigger.
