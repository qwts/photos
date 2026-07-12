---
'photos': minor
---

Import completion toast (#89): a clean import shows the green "Imported N
photos" toast (exact counts) with a Show action that jumps to Recent imports;
toasts now auto-dismiss at 4s per the design's ToastHost. The toast action is
a serializable marker in the shared reducer, mapped to its handler by the
shell.
