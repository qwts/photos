export type ReloadListener = (...args: unknown[]) => void;

export interface ReloadableWebContents {
  isDestroyed(): boolean;
  once(event: string, listener: ReloadListener): void;
  off(event: string, listener: ReloadListener): void;
  reloadIgnoringCache(): void;
}

function reloadOne(contents: ReloadableWebContents): Promise<void> {
  if (contents.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      contents.off('did-finish-load', finished);
      contents.off('did-fail-load', failed);
      contents.off('destroyed', destroyed);
    };
    const finished: ReloadListener = () => {
      cleanup();
      resolve();
    };
    const failed: ReloadListener = (...args) => {
      cleanup();
      const code = typeof args[1] === 'number' ? args[1] : -1;
      const description = typeof args[2] === 'string' ? args[2] : 'unknown failure';
      reject(new Error(`locked renderer reload failed (${String(code)}): ${description}`));
    };
    const destroyed: ReloadListener = () => {
      cleanup();
      resolve();
    };
    contents.once('did-finish-load', finished);
    contents.once('did-fail-load', failed);
    contents.once('destroyed', destroyed);
    contents.reloadIgnoringCache();
  });
}

export function reloadWebContentsForLock(contents: readonly ReloadableWebContents[]): Promise<void> {
  return Promise.all(contents.map(reloadOne)).then(() => undefined);
}
