import { app, BrowserWindow, powerMonitor } from 'electron';

import type { AppSettings } from '../../shared/settings/settings.js';
import type { AppLockControllerLike } from './app-lock-host.js';
import { registerHiddenWindowLock, type HiddenWindowLockSource } from './hidden-window-lock.js';
import { idleLimitSeconds } from './app-lock-policy.js';
import { registerLastWindowLock } from './last-window-lock.js';

const POLL_MS = 15_000;

export interface AppLockLifecycleOptions {
  readonly controller: AppLockControllerLike;
  readonly settings: () => Pick<AppSettings, 'appLockIdle' | 'lockWhenHidden'>;
}

function hiddenWindowSource(win: BrowserWindow): HiddenWindowLockSource {
  return {
    subscribe: (event, listener) => {
      switch (event) {
        case 'enter-full-screen':
          win.on('enter-full-screen', listener);
          break;
        case 'leave-full-screen':
          win.on('leave-full-screen', listener);
          break;
        case 'hide':
          win.on('hide', listener);
          break;
        case 'minimize':
          win.on('minimize', listener);
          break;
      }
    },
    unsubscribe: (event, listener) => {
      switch (event) {
        case 'enter-full-screen':
          win.off('enter-full-screen', listener);
          break;
        case 'leave-full-screen':
          win.off('leave-full-screen', listener);
          break;
        case 'hide':
          win.off('hide', listener);
          break;
        case 'minimize':
          win.off('minimize', listener);
          break;
      }
    },
    isVisible: () => win.isVisible(),
    isMinimized: () => win.isMinimized(),
  };
}

export function registerAppLockLifecycle(options: AppLockLifecycleOptions): () => void {
  const lock = (): void => {
    if (options.controller.snapshot().state === 'unlocked') void options.controller.lock();
  };
  const onSessionLock = (): void => lock();
  powerMonitor.on('lock-screen', onSessionLock);
  powerMonitor.on('suspend', onSessionLock);
  powerMonitor.on('user-did-resign-active', onSessionLock);

  const windowCleanups = new Map<BrowserWindow, () => void>();
  const watchWindow = (win: BrowserWindow): void => {
    if (windowCleanups.has(win)) return;
    const stopHiddenLock = registerHiddenWindowLock({
      source: hiddenWindowSource(win),
      platform: process.platform,
      enabled: () => options.settings().lockWhenHidden,
      lock,
    });
    const onClosed = (): void => {
      stopHiddenLock();
      windowCleanups.delete(win);
    };
    win.once('closed', onClosed);
    windowCleanups.set(win, () => {
      win.off('closed', onClosed);
      stopHiddenLock();
    });
  };
  for (const win of BrowserWindow.getAllWindows()) watchWindow(win);
  const onWindow = (_event: Electron.Event, win: BrowserWindow): void => watchWindow(win);
  app.on('browser-window-created', onWindow);
  const offLastWindowLock = registerLastWindowLock(app, process.platform, () => options.settings().lockWhenHidden, lock);

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
    offLastWindowLock();
    for (const cleanup of windowCleanups.values()) cleanup();
    windowCleanups.clear();
  };
}
