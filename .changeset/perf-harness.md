---
'photos': patch
---

Perf harness + budgets (#123): the 200K target becomes measurable — `npm run test:perf` (own Playwright config, never a per-PR gate; manual CI lane via perf.yml) measures cold-start-to-grid, IPC query latency medians (page/counts/search), scroll frame-drop rate at the three design zooms, full-pipeline import throughput, and memory ceilings, writes `perf-report.json`, and asserts the ratchet budgets in `tests/perf/budgets.ts` (recorded with baselines in the wiki Testing-Strategy).
