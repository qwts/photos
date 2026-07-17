import { app, BrowserWindow, type RenderProcessGoneDetails, type WebContents } from 'electron';

import type { DiagnosticsCaptureSource } from './capture-runtime.js';

export function electronDiagnosticsCaptureSource(): DiagnosticsCaptureSource {
  return {
    onMainRuntimeError: (listener) => {
      // The monitor observes without replacing Node's fatal exception behavior.
      // Error/message/stack arguments are intentionally ignored.
      const handler = (): void => listener();
      process.on('uncaughtExceptionMonitor', handler);
      return () => process.removeListener('uncaughtExceptionMonitor', handler);
    },
    onRendererProcessGone: (listener) => {
      const handler = (_event: Electron.Event, _contents: WebContents, details: RenderProcessGoneDetails): void => {
        listener({ reason: details.reason, exitCode: details.exitCode });
      };
      app.on('render-process-gone', handler);
      return () => app.removeListener('render-process-gone', handler);
    },
    onChildProcessGone: (listener) => {
      const handler = (_event: Electron.Event, details: Electron.Details): void => {
        listener({ reason: details.reason, exitCode: details.exitCode });
      };
      app.on('child-process-gone', handler);
      return () => app.removeListener('child-process-gone', handler);
    },
    onRendererUnresponsive: (listener) => {
      const tracked = new Map<BrowserWindow, () => void>();
      const track = (win: BrowserWindow): void => {
        if (tracked.has(win)) return;
        const handler = (): void => listener();
        tracked.set(win, handler);
        win.on('unresponsive', handler);
        win.once('closed', () => tracked.delete(win));
      };
      for (const win of BrowserWindow.getAllWindows()) track(win);
      const created = (_event: Electron.Event, win: BrowserWindow): void => track(win);
      app.on('browser-window-created', created);
      return () => {
        app.removeListener('browser-window-created', created);
        for (const [win, handler] of tracked) win.removeListener('unresponsive', handler);
        tracked.clear();
      };
    },
  };
}
