export interface InitialWindowVisibilityInput {
  readonly packaged: boolean;
  readonly harness: string | undefined;
  readonly mode: string | undefined;
  readonly noFocus: string | undefined;
}

export interface InitialWindowBehavior {
  readonly show: boolean;
  readonly backgroundThrottling: boolean;
  readonly showInactiveWhenReady: boolean;
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

/** Hidden Chromium windows must keep rendering and running timers like visible windows.
 * OVERLOOK_NO_FOCUS=1 keeps a visible window from activating the app: it opens via
 * showInactive() after ready-to-show, so perf lanes and agent-driven launches render
 * a real on-screen window without stealing the user's desktop focus. */
export function initialWindowBehavior(input: InitialWindowVisibilityInput): InitialWindowBehavior {
  const visible = shouldShowInitialWindow(input);
  const showInactiveWhenReady = visible && input.noFocus === '1';
  const show = visible && !showInactiveWhenReady;
  return { show, backgroundThrottling: show, showInactiveWhenReady };
}
