---
'photos': minor
---

Wire the opt-in LLM assistant's provider custody to IPC: list, connect, and disconnect cloud providers over the validated `llm:*` channels, exposed on `window.overlook.llm`. Keys are validated against the provider before they are sealed into OS-keychain custody, and never cross back to the renderer.
