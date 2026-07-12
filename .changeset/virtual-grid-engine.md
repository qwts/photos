---
'photos': minor
---

Virtualized grid engine for the 200K target: exact row/column math as a pure
shared module (auto-fill columns, stretched square tiles, 4px gaps), windowed
rendering with overscan, cursor-page data windowing with stale-request
cancellation, zoom-anchor scroll restoration, and frame-drop instrumentation
for the M11 perf budgets. The shell's content region now scrolls the real
library; `npm run seed:perf` boots a 200,000-row synthetic profile for
baselines.
