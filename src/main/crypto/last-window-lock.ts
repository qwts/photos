export interface WindowLifecycleSource {
  on(event: 'window-all-closed', listener: () => void): unknown;
  off(event: 'window-all-closed', listener: () => void): unknown;
}

export function registerLastWindowLock(
  source: WindowLifecycleSource,
  platform: NodeJS.Platform,
  lockWhenHidden: () => boolean,
  lock: () => void,
): () => void {
  const onAllWindowsClosed = (): void => {
    if (platform === 'darwin' && lockWhenHidden()) lock();
  };
  source.on('window-all-closed', onAllWindowsClosed);
  return () => source.off('window-all-closed', onAllWindowsClosed);
}
