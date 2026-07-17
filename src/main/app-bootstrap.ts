import { app, BrowserWindow } from 'electron';

// Profile-level single instance (ADR-0017 §5, #385): Electron scopes the
// lock to userData, so isolated E2E harness profiles still run concurrently.
// A second instance on the same profile hands off and exits; the first
// instance surfaces its window.
export function registerSingleInstance(): void {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
  }
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win !== undefined) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

export interface QuitTeardownOptions {
  readonly isLibraryOpen: () => boolean;
  /** 'unlocked' means the app-lock lifecycle owns the quit (its lock() runs
   * the same close path); anything else is ours. */
  readonly lockState: () => string | undefined;
  readonly close: () => Promise<void>;
}

// Universal quit teardown (ADR-0017 §4, #385): every open-library quit — most
// importantly the unconfigured-lock default — runs the full teardown, so WAL
// checkpoints and the library lock releases on ordinary exits too.
export function registerQuitTeardown(options: QuitTeardownOptions): void {
  let done = false;
  app.on('before-quit', (event) => {
    if (done || !options.isLibraryOpen()) return;
    if (options.lockState() === 'unlocked') return;
    event.preventDefault();
    done = true;
    void options.close().finally(() => app.quit());
  });
}
