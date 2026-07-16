import { app, BrowserWindow, powerMonitor } from 'electron';

import type { AppSettings } from '../../shared/settings/settings.js';
import type { AppLockController } from './app-lock-controller.js';
import { idleLimitSeconds } from './app-lock-policy.js';

const POLL_MS = 15_000;

export interface AppLockLifecycleOptions {
  readonly controller: AppLockController;
  readonly settings: () => Pick<AppSettings, 'appLockIdle' | 'lockWhenHidden'>;
}

export function registerAppLockLifecycle(options: AppLockLifecycleOptions): () => void {
  const lock = (): void => {
    if (options.controller.snapshot().state === 'unlocked') void options.controller.lock();
  };
  const onSessionLock = (): void => lock();
  powerMonitor.on('lock-screen', onSessionLock);
  powerMonitor.on('suspend', onSessionLock);
  powerMonitor.on('user-did-resign-active', onSessionLock);

  const onHidden = (): void => {
    if (options.settings().lockWhenHidden) lock();
  };
  const watchWindow = (win: BrowserWindow): void => {
    win.on('hide', onHidden);
    win.on('minimize', onHidden);
  };
  for (const win of BrowserWindow.getAllWindows()) watchWindow(win);
  const onWindow = (_event: Electron.Event, win: BrowserWindow): void => watchWindow(win);
  app.on('browser-window-created', onWindow);

  const timer = setInterval(() => {
    if (options.controller.snapshot().state !== 'unlocked') return;
    const limit = idleLimitSeconds(options.settings().appLockIdle);
    if (limit !== null && powerMonitor.getSystemIdleTime() >= limit) lock();
  }, POLL_MS);
  timer.unref();

  let quitAuthorized = false;
  const beforeQuit = (event: Electron.Event): void => {
    if (quitAuthorized || options.controller.snapshot().state !== 'unlocked') return;
    event.preventDefault();
    quitAuthorized = true;
    void options.controller.lock().finally(() => app.quit());
  };
  app.on('before-quit', beforeQuit);

  return () => {
    clearInterval(timer);
    powerMonitor.off('lock-screen', onSessionLock);
    powerMonitor.off('suspend', onSessionLock);
    powerMonitor.off('user-did-resign-active', onSessionLock);
    app.off('browser-window-created', onWindow);
    app.off('before-quit', beforeQuit);
    for (const win of BrowserWindow.getAllWindows()) {
      win.off('hide', onHidden);
      win.off('minimize', onHidden);
    }
  };
}
