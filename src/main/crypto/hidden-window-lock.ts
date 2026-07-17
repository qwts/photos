const FULL_SCREEN_EVENT_GRACE_MS = 2_000;

type HiddenWindowEvent = 'enter-full-screen' | 'hide' | 'leave-full-screen' | 'minimize';
type Schedule = (callback: () => void, delayMs: number) => () => void;

export interface HiddenWindowLockSource {
  readonly subscribe: (event: HiddenWindowEvent, listener: () => void) => void;
  readonly unsubscribe: (event: HiddenWindowEvent, listener: () => void) => void;
  readonly isMinimized: () => boolean;
  readonly isVisible: () => boolean;
}

export interface HiddenWindowLockOptions {
  readonly source: HiddenWindowLockSource;
  readonly platform: NodeJS.Platform;
  readonly enabled: () => boolean;
  readonly lock: () => void;
  readonly schedule?: Schedule;
}

function schedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}

/**
 * Electron exposes native full-screen completion events, but no matching
 * "will enter" event. macOS can emit hide/minimize while animating, so its
 * lock decision waits briefly for a full-screen completion event. Other
 * platforms preserve the immediate lock path.
 */
export function registerHiddenWindowLock(options: HiddenWindowLockOptions): () => void {
  const scheduleLock = options.schedule ?? schedule;
  let pendingHidden = false;
  let cancelPending: (() => void) | null = null;

  const cancelDeferredLock = (): void => {
    cancelPending?.();
    cancelPending = null;
  };
  const deferredLock = (): void => {
    cancelPending = null;
    if (!pendingHidden) return;
    pendingHidden = false;
    if (options.enabled()) options.lock();
  };
  const onHidden = (): void => {
    if (!options.enabled()) return;
    if (options.platform !== 'darwin') {
      options.lock();
      return;
    }
    pendingHidden = true;
    cancelDeferredLock();
    cancelPending = scheduleLock(deferredLock, FULL_SCREEN_EVENT_GRACE_MS);
  };
  const onFullScreenSettled = (): void => {
    if (!pendingHidden) return;
    cancelDeferredLock();
    pendingHidden = false;
    if (options.enabled() && (!options.source.isVisible() || options.source.isMinimized())) options.lock();
  };

  options.source.subscribe('enter-full-screen', onFullScreenSettled);
  options.source.subscribe('leave-full-screen', onFullScreenSettled);
  options.source.subscribe('hide', onHidden);
  options.source.subscribe('minimize', onHidden);

  return () => {
    cancelDeferredLock();
    pendingHidden = false;
    options.source.unsubscribe('enter-full-screen', onFullScreenSettled);
    options.source.unsubscribe('leave-full-screen', onFullScreenSettled);
    options.source.unsubscribe('hide', onHidden);
    options.source.unsubscribe('minimize', onHidden);
  };
}
