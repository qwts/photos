import type { CommandMenuContext } from '../../../shared/commands/menu-contract.js';
import type { AppState } from '../../../shared/library/app-state.js';

/** Non-modal overlays that still count as an active "other" dialog for command enablement. */
export interface OverlayFlags {
  readonly shortcut: boolean;
  readonly interop: boolean;
  readonly unlock: boolean;
  readonly offload: boolean;
}

/**
 * Classify the active modal surface for the shared command-menu context
 * (ADR-0024 #531). The dialog-family reducer keeps these mutually exclusive, so
 * the first open one wins; loose overlays collapse to `other`.
 */
export function commandMenuDialogClass(state: AppState, overlays: OverlayFlags): CommandMenuContext['dialog'] {
  if (state.importOpen) return 'import';
  if (state.exportOpen) return 'export';
  if (state.settingsOpen) return 'settings';
  if (state.librariesOpen) return 'libraries';
  if (overlays.shortcut || overlays.interop || overlays.unlock || overlays.offload) return 'other';
  return 'none';
}
