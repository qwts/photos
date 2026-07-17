---
'photos': patch
---

Production release hardening and licensing compliance.

- Minify main/preload/renderer bundles, emit no source maps, and enable Electron
  production fuses (runAsNode off, cookie encryption, NODE_OPTIONS/`--inspect`
  ignored, onlyLoadAppFromAsar + embedded asar integrity validation).
- Add the `license` field, generate and ship `THIRD-PARTY-NOTICES.md` for the
  shipped dependency closure, and bundle it plus `LICENSE` into the packaged app.
- Add a `lint:licenses` policy gate (SPDX allowlist + reviewed exceptions),
  notices-freshness check, and a CycloneDX SBOM release artifact.
