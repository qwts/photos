import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useIntl } from 'react-intl';

import { IntlHost } from '../../src/renderer/src/i18n/IntlHost.js';
import { useFormats } from '../../src/renderer/src/i18n/use-formats.js';

// Integration coverage for the renderer i18n runtime (#403): IntlHost fetches
// the main-resolved locale, stamps lang/dir on <html>, and renders children
// through the catalog + pseudo pipeline.

let root: Root | undefined;

function mockOverlook(locale: string): () => void {
  const previous = (window as unknown as { overlook?: unknown }).overlook;
  (window as unknown as { overlook: unknown }).overlook = {
    getLocale: () => Promise.resolve(locale),
    settings: { onChanged: () => () => undefined },
  };
  return () => {
    (window as unknown as { overlook?: unknown }).overlook = previous;
  };
}

function Probe(): ReactElement {
  const intl = useIntl();
  return <span data-testid="probe">{intl.formatMessage({ id: 'toolbar.import', defaultMessage: 'Import' })}</span>;
}

function FormatsProbe(): ReactElement {
  const { formatBytes, formatCalendarDate, formatCount } = useFormats();
  return (
    <span data-testid="formats-probe">{[formatCount(1234), formatBytes(98_400_000), formatCalendarDate('2026-07-12')].join(' · ')}</span>
  );
}

afterEach(() => {
  if (root !== undefined) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

test('IntlHost renders the source catalog and stamps lang/dir', async () => {
  const restore = mockOverlook('en');
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <IntlHost>
        <Probe />
      </IntlHost>,
    );
  });
  // Flush the async getLocale() round-trip and the resulting re-render.
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(document.querySelector('[data-testid="probe"]')?.textContent, 'Import');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.documentElement.dir, 'ltr');
  restore();
});

test('the en-XB pseudo-locale transforms copy and flips dir to rtl', async () => {
  const restore = mockOverlook('en-XB');
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <IntlHost>
        <Probe />
      </IntlHost>,
    );
  });
  // Flush the async getLocale() round-trip and the resulting re-render.
  await act(async () => {
    await Promise.resolve();
  });

  const text = document.querySelector('[data-testid="probe"]')?.textContent ?? '';
  assert.notEqual(text, 'Import'); // accented + bidi-wrapped, not the source
  assert.match(text, /⟪.*⟫/u); // bidi pseudo wrapping
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(document.documentElement.lang, 'en-XB');
  restore();
});

test('renderer formatters bind to the locale supplied by IntlHost', async () => {
  const restore = mockOverlook('de');
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <IntlHost>
        <FormatsProbe />
      </IntlHost>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(document.querySelector('[data-testid="formats-probe"]')?.textContent, '1.234 · 98,4 MB · 12. Juli 2026');
  restore();
});
