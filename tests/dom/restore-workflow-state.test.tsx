import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { IntlHost } from '../../src/renderer/src/i18n/IntlHost.js';
import { RestoreWorkflow } from '../../src/renderer/src/restore/RestoreWorkflow.js';

// #748: every result on the restore dialog belongs to exactly one discovery.
// A failed attempt against provider A must not leave its error, session, or
// library list rendered over provider B's screens.

let root: Root | undefined;
let container: HTMLElement | undefined;

type DiscoverRequest = { providerId: string } & Record<string, unknown>;

function mockOverlook(): { discovered: DiscoverRequest[]; restore: () => void } {
  const discovered: DiscoverRequest[] = [];
  const previous = (window as unknown as { overlook?: unknown }).overlook;
  const providers = [
    { id: 'prov-a', label: 'Provider A', available: true, unavailableReason: null },
    { id: 'prov-b', label: 'Provider B', available: true, unavailableReason: null },
  ];
  (window as unknown as { overlook: unknown }).overlook = {
    getLocale: () => Promise.resolve('en-US'),
    settings: {
      get: () => Promise.resolve({ settings: { providerId: 'prov-a' } }),
      onChanged: () => () => undefined,
    },
    backup: {
      providers: () => Promise.resolve({ providers, defaultProviderId: 'prov-a' }),
      providerStatus: () => Promise.resolve({ connected: true, provider: providers[0], account: null }),
      connect: () => Promise.resolve({ ok: true, reason: null }),
    },
    restore: {
      onProgress: () => () => undefined,
      pickKey: () => Promise.resolve({ path: null }),
      discover: (request: DiscoverRequest) => {
        discovered.push(request);
        if (request.providerId === 'prov-a') {
          return Promise.resolve({
            sessionId: null,
            libraries: [],
            error: { reason: 'corrupt', message: 'manifest references missing blobs/a3/deadbeef' },
          });
        }
        return Promise.resolve({
          sessionId: 'session-b',
          libraries: [
            {
              libraryId: '01KY000QE5PMZR2P66DX0CCR6D',
              generation: 1,
              generatedAt: '2026-07-22T19:32:00.000Z',
              photos: 5,
              totalBytes: 16_200_000,
              albums: 3,
              compatibility: 'compatible',
              validation: 'valid',
              fallbackGenerations: 0,
              resumable: false,
            },
          ],
          error: null,
        });
      },
    },
  };
  return {
    discovered,
    restore: () => {
      (window as unknown as { overlook?: unknown }).overlook = previous;
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

test('a failed discovery error clears when the provider changes (#748)', async () => {
  const mocked = mockOverlook();
  try {
    container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      root = createRoot(container as HTMLElement);
      root.render(
        <IntlHost>
          <RestoreWorkflow context="settings" />
        </IntlHost>,
      );
      await Promise.resolve();
    });
    await flush();

    const localKeyButton = [...(container.querySelectorAll('button') ?? [])].find((button) =>
      (button.textContent ?? '').includes("Restore with this Mac's key"),
    );
    assert.ok(localKeyButton, 'the settings context offers the local-key action');
    act(() => {
      localKeyButton.click();
    });
    await flush();
    assert.match(container.textContent ?? '', /manifest references missing/u, 'provider A’s failure renders');

    const select = container.querySelector('select');
    assert.ok(select);
    act(() => {
      select.value = 'prov-b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    assert.doesNotMatch(
      container.textContent ?? '',
      /manifest references missing/u,
      'provider A’s stale error must not render over provider B',
    );
  } finally {
    mocked.restore();
  }
});

test('Back from the library list clears the previous discovery (#748)', async () => {
  const mocked = mockOverlook();
  try {
    container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      root = createRoot(container as HTMLElement);
      root.render(
        <IntlHost>
          <RestoreWorkflow context="settings" />
        </IntlHost>,
      );
      await Promise.resolve();
    });
    await flush();

    const select = container.querySelector('select');
    assert.ok(select);
    act(() => {
      select.value = 'prov-b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    const localKeyButton = [...(container.querySelectorAll('button') ?? [])].find((button) =>
      (button.textContent ?? '').includes("Restore with this Mac's key"),
    );
    assert.ok(localKeyButton);
    act(() => {
      localKeyButton.click();
    });
    await flush();
    assert.match(container.textContent ?? '', /01KY000QE5PMZR2P66DX0CCR6D/u, 'provider B’s library renders');

    const back = [...(container.querySelectorAll('button') ?? [])].find((button) => (button.textContent ?? '').trim() === 'Back');
    assert.ok(back);
    act(() => {
      back.click();
    });
    await flush();
    assert.doesNotMatch(container.textContent ?? '', /01KY000QE5PMZR2P66DX0CCR6D/u, 'the stale library list is gone after Back');
  } finally {
    mocked.restore();
  }
});
