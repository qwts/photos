import { readFileSync, writeSync } from 'node:fs';

import { resolveHeicPreview, type HeicPreviewResult } from './import/heic-preview.js';

export const HEIC_SMOKE_ARGUMENT_PREFIX = '--overlook-heic-smoke=';
export const HEIC_SMOKE_READY_MARKER = 'overlook-heic-smoke:ready';

interface HeicSmokeApp {
  exit(code: number): void;
}

interface HeicSmokeOptions {
  readonly argv?: readonly string[] | undefined;
  readonly read?: ((path: string) => Buffer) | undefined;
  readonly decode?: ((bytes: Buffer) => Promise<HeicPreviewResult | null>) | undefined;
  readonly write?: ((value: string) => unknown) | undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Packaged-app probe for the shipped native ImageIO bridge. It runs before
 * library/keychain bootstrap and zeroizes both fixture and decoded payload. */
export async function exitForHeicSmokeIfRequested(app: HeicSmokeApp, options: HeicSmokeOptions = {}): Promise<boolean> {
  const argument = (options.argv ?? process.argv).find((value) => value.startsWith(HEIC_SMOKE_ARGUMENT_PREFIX));
  if (argument === undefined) return false;
  const path = argument.slice(HEIC_SMOKE_ARGUMENT_PREFIX.length);
  const write = options.write ?? ((value: string) => writeSync(process.stdout.fd, value));
  let original: Buffer | undefined;
  let preview: Buffer | undefined;
  let exitCode = 1;
  try {
    if (path === '') throw new Error('fixture path is empty');
    original = (options.read ?? readFileSync)(path);
    const result = await (options.decode ?? ((bytes) => resolveHeicPreview(bytes)))(original);
    if (result === null) throw new Error('decode was cancelled');
    if (!result.ok) throw new Error(`decode failed: ${result.reason}`);
    preview = result.preview.bytes;
    if (preview.length < 3 || preview[0] !== 0xff || preview[1] !== 0xd8 || preview[2] !== 0xff) {
      throw new Error('decoder returned a non-JPEG payload');
    }
    write(`${HEIC_SMOKE_READY_MARKER}:${String(result.preview.width)}x${String(result.preview.height)}\n`);
    exitCode = 0;
  } catch (error) {
    write(`overlook-heic-smoke:error:${message(error)}\n`);
  } finally {
    original?.fill(0);
    preview?.fill(0);
    app.exit(exitCode);
  }
  return true;
}
