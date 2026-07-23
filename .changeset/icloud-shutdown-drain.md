---
'overlook': patch
---

Prevent iCloud Drive async completions from aborting the app during shutdown by draining raw native operations and suppressing JavaScript callbacks after environment teardown begins (#752).
