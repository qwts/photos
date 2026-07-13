---
'photos': patch
---

Provider connect/disconnect now runs through the backup service (`backup:connect` / `backup:disconnect`) instead of a bare settings patch — groundwork for pCloud sign-in (#254). Mock-provider behavior is unchanged; disconnecting now also drops any stored pCloud credentials.
