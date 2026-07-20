export interface InitialWindowVisibilityInput {
  readonly packaged: boolean;
  readonly harness: string | undefined;
  readonly mode: string | undefined;
}

export interface InitialWindowBehavior {
  readonly show: boolean;
  readonly backgroundThrottling: boolean;
}

export interface NativeWindowAttentionTarget {
  readonly isMinimized: () => boolean;
  readonly restore: () => void;
  readonly isVisible: () => boolean;
  readonly show: () => void;
  readonly focus: () => void;
}

/** Hide local macOS E2E windows without changing Linux/Xvfb rendering behavior. */
export function resolveE2EWindowMode(platform: string, visibleOverride: string | undefined): 'hidden' | 'visible' {
  return platform === 'darwin' && visibleOverride !== '1' ? 'hidden' : 'visible';
}

/** Keep native windows out of the user's way during Electron E2E runs.
 * Packaged apps and ordinary development launches always remain visible. */
export function shouldShowInitialWindow({ packaged, harness, mode }: InitialWindowVisibilityInput): boolean {
  return packaged || harness !== '1' || mode !== 'hidden';
}

/** Hidden Chromium windows must keep rendering and running timers like visible windows. */
export function initialWindowBehavior(input: InitialWindowVisibilityInput): InitialWindowBehavior {
  const show = shouldShowInitialWindow(input);
  return { show, backgroundThrottling: show };
}

/** Surface an existing app window unless the local harness deliberately keeps
 * native windows off the user's desktop. External-open delivery still runs in
 * hidden mode; only the OS-level restore/show/focus side effects are skipped. */
export function requestNativeWindowAttention(target: NativeWindowAttentionTarget, input: InitialWindowVisibilityInput): void {
  if (!shouldShowInitialWindow(input)) return;
  if (target.isMinimized()) target.restore();
  if (!target.isVisible()) target.show();
  target.focus();
}
