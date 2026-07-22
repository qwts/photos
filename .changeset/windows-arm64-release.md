---
'photos': minor
---

Publish native Windows ARM64 installers alongside x64 (first slices of #683).
The Package/Release workflows now build a Windows leg per architecture on the
x64 `windows-latest` runner and emit architecture-qualified NSIS installers
(`Overlook-<version>-<arch>.exe`, uploaded as `overlook-windows-x64` /
`overlook-windows-arm64`) so the two can never overwrite or be confused. A new
`verify-windows-arch.mjs` gate reads the PE machine type of the installed
`Overlook.exe` and every shipped `*.node` (sharp, encrypted SQLite) and fails
the leg on any mixed-architecture payload from a bad cross-compile. Windows
Authenticode signing is wired env-gated behind `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD` (SHA-256 + RFC 3161 timestamp, verified with
`signtool`), mirroring the macOS signing foundation; a tag is a full release
only when every platform can sign. Builds stay unsigned pre-releases until the
owner supplies the certificate. Ships the ARM64 signed-release manual
acceptance checklist.
