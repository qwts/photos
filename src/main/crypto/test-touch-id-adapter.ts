import { TouchIdAdapterError, type TouchIdAvailability, type TouchIdSecureAdapter } from './touch-id.js';

/** Deterministic, memory-only CI adapter. Production activation is blocked by
 * app-lock-runtime's app.isPackaged gate. */
export class TestTouchIdAdapter implements TouchIdSecureAdapter {
  private item: { readonly account: string; readonly secret: Buffer } | undefined;

  availability(): TouchIdAvailability {
    return { available: true, reason: null };
  }

  store(account: string, secret: Buffer): Promise<void> {
    this.clearSecret();
    this.item = { account, secret: Buffer.from(secret) };
    return Promise.resolve();
  }

  read(account: string, _reason: string): Promise<Buffer> {
    if (this.item?.account !== account) return Promise.reject(new TouchIdAdapterError('missing'));
    return Promise.resolve(Buffer.from(this.item.secret));
  }

  clear(account: string): Promise<void> {
    if (this.item?.account === account) this.clearSecret();
    return Promise.resolve();
  }

  private clearSecret(): void {
    this.item?.secret.fill(0);
    this.item = undefined;
  }
}
