export const RELEASE_SMOKE_ARGUMENT = '--overlook-release-smoke';
export const RELEASE_SMOKE_READY_MARKER = 'overlook-release-smoke:ready';

interface ReleaseSmokeApp {
  exit(code: number): void;
}

export function exitForReleaseSmokeIfRequested(
  app: ReleaseSmokeApp,
  argv: readonly string[] = process.argv,
  write: (value: string) => unknown = (value) => process.stdout.write(value),
): boolean {
  if (!argv.includes(RELEASE_SMOKE_ARGUMENT)) return false;
  write(`${RELEASE_SMOKE_READY_MARKER}\n`);
  app.exit(0);
  return true;
}
