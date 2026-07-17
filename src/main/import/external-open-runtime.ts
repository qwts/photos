import { app, BrowserWindow } from 'electron';

import { events } from '../../shared/ipc/channels.js';
import { createEmitter } from '../../shared/ipc/registry.js';
import { createWindow } from '../app-window.js';
import { commandLineOpenPaths, ExternalOpenIntake } from './external-open-intake.js';

export interface ExternalOpenRuntime {
  readonly whenReady: () => Promise<void>;
  readonly rendererReady: () => void;
  readonly followAuthorization: (source: ExternalOpenAuthorizationSource) => void;
  readonly finishBootstrap: () => void;
  readonly close: () => void;
}

export interface ExternalOpenAuthorizationSource {
  readonly snapshot: () => { readonly state: string };
  readonly subscribe: (listener: (state: { readonly state: string }) => void) => unknown;
}

/** Installs pre-ready OS document handlers before Electron can dispatch macOS
 * open-file events. Every path then enters one coalesced renderer queue. */
export function createExternalOpenRuntime(): ExternalOpenRuntime {
  const initialOpenPaths = commandLineOpenPaths(process.argv, app.isPackaged, process.cwd());
  const primaryInstance = app.requestSingleInstanceLock();
  if (!primaryInstance) app.quit();

  const emit = createEmitter(events.importExternalPaths, (name, payload) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(name, payload);
  });
  let runtimeReady = false;
  const intake = new ExternalOpenIntake({
    deliver: (paths) => emit({ paths: [...paths] }),
    // BrowserWindow APIs are unavailable during macOS open-file cold start.
    attention: () => {
      if (runtimeReady) focusPrimaryWindow();
    },
  });

  const openPrimaryWindow = (): BrowserWindow => {
    intake.rendererUnavailable();
    const win = createWindow();
    win.on('closed', () => intake.rendererUnavailable());
    return win;
  };
  const focusPrimaryWindow = (): void => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win === undefined) {
      if (runtimeReady) openPrimaryWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  };

  if (primaryInstance) {
    intake.enqueue(initialOpenPaths);
    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      intake.enqueue([filePath]);
    });
    app.on('second-instance', (_event, argv, workingDirectory) => {
      intake.enqueue(commandLineOpenPaths(argv, app.isPackaged, workingDirectory), workingDirectory);
    });
  }

  return {
    whenReady: () => (primaryInstance ? app.whenReady() : new Promise<void>(() => undefined)),
    rendererReady: () => intake.rendererReady(),
    followAuthorization: (source) => {
      const update = ({ state }: { readonly state: string }): void => {
        intake.setAuthorized(state === 'unconfigured-unlocked' || state === 'unlocked');
      };
      update(source.snapshot());
      source.subscribe(update);
    },
    finishBootstrap: () => {
      runtimeReady = true;
      openPrimaryWindow();
      app.on('activate', focusPrimaryWindow);
    },
    close: () => intake.close(),
  };
}
