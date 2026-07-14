import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { useEffect } from 'react';

import { Sidebar } from './Sidebar';
import type { OverlookApi } from '../../../shared/ipc/api.js';
import type { AlbumSummary, LibraryStats, SourceCounts } from '../../../shared/library/types.js';
import { AppStateProvider, useAppDispatch } from '../state/app-state-context';

// #238 exit criteria: the sidebar collapses to the 56px icon rail (labels
// and counts move to right-side tooltips, headings become dividers, the
// backup card becomes the shield button that opens Settings) and the state
// persists under the mock's own localStorage key across mounts.

const COLLAPSE_KEY = 'overlook.sidebarCollapsed';

function installStub(): void {
  // Sidebar listens to backup progress; AppStateProvider to pending pushes.
  // Both stay silent here — the stories drive the component with props.
  const library = { onPendingCountChanged: () => () => undefined } as unknown as OverlookApi['library'];
  const backup = {
    onProgress: () => () => undefined,
    onCompleted: () => () => undefined,
  } as unknown as OverlookApi['backup'];
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = { library, backup };
}

const counts: SourceCounts = { all: 204318, favorites: 11, recent: 96, offloaded: 12, deleted: 3 };
const stats: LibraryStats = {
  photos: 204318,
  bytes: 1_200_000_000_000,
  pending: 0,
  lastBackupAt: null,
  offloadedBytes: 380_000_000_000,
};
const albums: readonly AlbumSummary[] = [
  { id: 'a1', name: 'Iceland', count: 214 },
  { id: 'a2', name: 'Studio scans', count: 1042 },
];

const meta: Meta<typeof Sidebar> = {
  title: 'App/Sidebar',
  component: Sidebar,
  args: { counts, stats, albums },
  decorators: [
    (Story) => {
      installStub();
      return (
        <AppStateProvider>
          <div style={{ height: 480, display: 'flex' }}>
            <Story />
          </div>
        </AppStateProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

export const Expanded: Story = {
  loaders: [
    () => {
      window.localStorage.removeItem(COLLAPSE_KEY);
      return Promise.resolve({});
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('All Photos')).toBeVisible();
    // Offloaded earns its row here: counts.offloaded is 12 (#268).
    await expect(canvas.getByText('Offloaded')).toBeVisible();
    await expect(canvas.getByTestId('backup-card')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  },
};

export const CollapseAndExpand: Story = {
  loaders: [
    () => {
      window.localStorage.removeItem(COLLAPSE_KEY);
      return Promise.resolve({});
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse sidebar' }));
    // Rail mode: labels/counts gone, headings replaced by dividers, the
    // backup card replaced by the shield; the choice persisted.
    await waitFor(async () => {
      await expect(canvas.queryByText('All Photos')).not.toBeInTheDocument();
    });
    await expect(canvas.queryByText('Library')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('backup-card')).not.toBeInTheDocument();
    await expect(canvas.getByTestId('backup-shield')).toBeVisible();
    await expect(window.localStorage.getItem(COLLAPSE_KEY)).toBe('1');
    // The rail's icon-square metrics must win over the base row rule
    // (PR #245 review — source-order regression guard).
    const railRow = canvas.getByRole('button', { name: 'All Photos · 204,318' });
    await expect(window.getComputedStyle(railRow).width).toBe('36px');
    await expect(window.getComputedStyle(railRow).height).toBe('32px');
    // Every destination stays reachable: a rail row hover surfaces the
    // label + count in a right-side tooltip.
    // The just-clicked toggle keeps focus (and so its own tooltip) — query
    // all open tooltips and find the row's.
    await userEvent.hover(canvas.getByRole('button', { name: 'All Photos · 204,318' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(async () => {
      const tips = body.getAllByRole('tooltip').map((tip) => tip.textContent);
      await expect(tips).toContain('All Photos · 204,318');
    });
    await userEvent.unhover(canvas.getByRole('button', { name: 'All Photos · 204,318' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Expand sidebar' }));
    await waitFor(async () => {
      await expect(canvas.getByText('All Photos')).toBeVisible();
    });
    await expect(window.localStorage.getItem(COLLAPSE_KEY)).toBe('0');
  },
};

export const StartsCollapsedFromPersistedState: Story = {
  loaders: [
    () => {
      window.localStorage.setItem(COLLAPSE_KEY, '1');
      return Promise.resolve({});
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await expect(canvas.queryByText('All Photos')).not.toBeInTheDocument();
    await expect(canvas.getByTestId('backup-shield')).toBeVisible();
  },
};

// Story-only helper: flips the provider to disconnected the way Shell's
// settings sync would (#239).
function ForceDisconnected(): null {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({ type: 'providerConnected/set', connected: false });
  }, [dispatch]);
  return null;
}

export const Disconnected: Story = {
  loaders: [
    () => {
      window.localStorage.removeItem(COLLAPSE_KEY);
      return Promise.resolve({});
    },
  ],
  render: (args) => (
    <>
      <ForceDisconnected />
      <Sidebar {...args} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // No fabricated backup state: the progress figure is gone, the storage
    // line is local-only, and the Connect path is offered.
    await waitFor(async () => {
      await expect(canvas.getByTestId('sidebar-connect')).toBeVisible();
    });
    await expect(canvas.getByTestId('backup-card')).not.toHaveTextContent('PCLOUD');
    await expect(canvas.getByText('Library encrypted')).toBeVisible();
  },
};

// #268: no offload flow exists in-app yet — an always-empty Offloaded
// destination reads as broken, so the row only appears once rows exist.
export const OffloadedHiddenWhenEmpty: Story = {
  args: { counts: { ...counts, offloaded: 0 } },
  loaders: [
    () => {
      window.localStorage.removeItem(COLLAPSE_KEY);
      return Promise.resolve({});
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('All Photos')).toBeVisible();
    await expect(canvas.queryByText('Offloaded')).not.toBeInTheDocument();
  },
};
