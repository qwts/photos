import type { WebContents } from 'electron';

const MAX_DIAGNOSTICS = 12;

export interface BlockedWindowNavigation {
  readonly source: 'navigation' | 'window-open';
  readonly scheme: string;
}

export type WindowNavigationReporter = (diagnostic: BlockedWindowNavigation) => void;

type GuardedWebContents = Pick<WebContents, 'on' | 'setWindowOpenHandler'>;

let diagnosticCount = 0;

function schemeOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return 'invalid';
  }
}

function reportBounded(diagnostic: BlockedWindowNavigation): void {
  if (diagnosticCount >= MAX_DIAGNOSTICS) return;
  diagnosticCount += 1;
  console.info(`[overlook] blocked ${diagnostic.source} scheme=${diagnostic.scheme}`);
}

/** Keep OS drops and renderer content from replacing the trusted document or
 * creating unowned windows. Diagnostics contain only the navigation source
 * and URL scheme, never a file URL's private path. */
export function installWindowNavigationPolicy(webContents: GuardedWebContents, report: WindowNavigationReporter = reportBounded): void {
  webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    report({ source: 'navigation', scheme: schemeOf(url) });
  });
  webContents.setWindowOpenHandler(({ url }) => {
    report({ source: 'window-open', scheme: schemeOf(url) });
    return { action: 'deny' };
  });
}
