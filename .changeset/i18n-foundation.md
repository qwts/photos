---
---

Internationalization foundation (#403), no user-facing behavior change: the app
still ships English only, rendering the same copy. Adds the react-intl catalog
runtime (renderer), the `src/shared/i18n/` locale model, main-side locale
resolution over `app:get-locale`, catalog extraction/compile tooling, `en-XA`/
`en-XB` pseudo-locales, and a shrink-only hardcoded-string ratchet in the lint
chain. Toolbar, Sidebar, and Settings now render through the message catalog.
