import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { app } from 'electron';

import { pickSafeStorage } from '../crypto/safe-storage-runtime.js';
import { getSettingsStore } from '../settings/settings-runtime.js';
import { attachDiagnosticsCapture } from './capture-runtime.js';
import { DiagnosticsQueue } from './diagnostics-queue.js';
import { DiagnosticsService } from './diagnostics-service.js';
import { electronDiagnosticsCaptureSource } from './electron-capture-source.js';

function createDiagnosticsRuntime(): { readonly service: DiagnosticsService; readonly close: () => void } {
  const settings = getSettingsStore();
  const service = new DiagnosticsService({
    queue: new DiagnosticsQueue({
      dataDir: path.join(app.getPath('userData'), 'diagnostics'),
      safeStorage: pickSafeStorage(),
    }),
    settings: () => settings.get(),
    eventId: randomUUID,
    now: () => new Date(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    // Code-only logging: never attach the rejected event or underlying error.
    failure: (code) => console.error(`[overlook] diagnostics capture skipped: ${code}`),
  });
  service.reconcileConsent();
  const unsubscribeSettings = settings.subscribe(() => service.reconcileConsent());
  const detachCapture = attachDiagnosticsCapture(electronDiagnosticsCaptureSource(), service);
  return {
    service,
    close: () => {
      detachCapture();
      unsubscribeSettings();
    },
  };
}

export function registerDiagnosticsLifecycle(): void {
  void app.whenReady().then(() => {
    const runtime = createDiagnosticsRuntime();
    app.once('will-quit', runtime.close);
  });
}
