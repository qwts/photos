import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SettingsDialog } from './SettingsDialog';
import { defaultSettings, mergeSettings, type AppSettings } from '../../../shared/settings/settings.js';
import type { OverlookApi } from '../../../shared/ipc/api.js';

// #112–#114 exit criteria: the 640px two-pane frame (Storage & Backup opens
// by default, nav switches panes, keyboard-operable, Esc closes), the
// General section (sort segmented wired to the store stub, Light disabled
// with the dark-only hint, thumbnails locked on), and the Storage & Backup
// section (connection card + disconnected-disables-everything). The
// decorator installs in-memory window.overlook settings + backup stubs.

function installStub(): void {
  let current: AppSettings = { ...defaultSettings };
  const settingsApi: OverlookApi['settings'] = {
    get: () => Promise.resolve({ settings: current }),
    set: ({ patch }) => {
      current = mergeSettings(current, patch);
      return Promise.resolve({ settings: current });
    },
    onChanged: () => () => undefined,
  };
  const backupApi: OverlookApi['backup'] = {
    run: () => Promise.resolve({ uploaded: 0, failed: 0, skipped: null }),
    onProgress: () => () => undefined,
    onCompleted: () => () => undefined,
    offload: () => Promise.resolve({ offloaded: 0, skipped: 0, freedBytes: 0 }),
    rehydrate: () => Promise.resolve({ ok: true }),
    // The card's truth follows the stub store's providerId, like main does.
    providerStatus: () =>
      Promise.resolve(
        current.providerId === null
          ? { provider: 'mock' as const, connected: false, account: null, usedBytes: 0, totalBytes: 0 }
          : { provider: 'mock' as const, connected: true, account: null, usedBytes: 380_000_000_000, totalBytes: 500_000_000_000 },
      ),
  };
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = { settings: settingsApi, backup: backupApi };
}

const meta: Meta<typeof SettingsDialog> = {
  title: 'App/SettingsDialog',
  component: SettingsDialog,
  args: { open: true, onClose: fn() },
  decorators: [
    (Story) => {
      installStub();
      return <Story />;
    },
  ],
};

export default meta;
type Story = StoryObj<typeof SettingsDialog>;

export const StorageOpensByDefault: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    const storage = body.getByRole('button', { name: 'Storage & Backup' });
    await expect(storage).toHaveAttribute('aria-current', 'true');
    // The real pane (#114): connected card with live quota + enabled knobs.
    await waitFor(() => expect(body.getByText('Connected')).toBeVisible());
    await expect(body.getByText('THIS DEVICE · 380 GB / 500 GB USED')).toBeVisible();
    await expect(body.getByText('Back up new imports automatically')).toBeVisible();
  },
};

export const DisconnectDisablesEverything: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('button', { name: 'Disconnect' })).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Disconnect' }));

    // Disconnected-first per design: badge flips, quota gone, ALL backup
    // controls disable — only the locked Encrypt switch stays (disabled too).
    await waitFor(() => expect(body.getByText('Not connected')).toBeVisible());
    await expect(body.getByText('Link a provider to store encrypted originals off-device.')).toBeVisible();
    for (const control of body.getAllByRole('switch')) {
      await expect(control).toBeDisabled();
    }
    await expect(body.getByRole('radio', { name: 'Copy' })).toBeDisabled();
    await expect(body.getByRole('radio', { name: 'Move' })).toBeDisabled();

    // Reconnect: instant with the mock, quota returns.
    await userEvent.click(body.getByRole('button', { name: 'Connect Mock provider' }));
    await waitFor(() => expect(body.getByText('Connected')).toBeVisible());
    await expect(body.getByText('THIS DEVICE · 380 GB / 500 GB USED')).toBeVisible();
  },
};

export const NavSwitchesPanes: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'General' }));
    await expect(body.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(body.getByText('Default sort order')).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Privacy' }));
    await expect(body.getByText('Privacy settings land here next.')).toBeVisible();
  },
};

export const KeyboardOperable: Story = {
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    // The nav rows are real buttons: Tab reaches them (after the header's
    // Close control), Enter activates.
    await userEvent.tab();
    await userEvent.tab();
    await expect(body.getByRole('button', { name: 'General' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.getByText('Default sort order')).toBeVisible());
    // Esc closes from anywhere inside the dialog.
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const GeneralSection: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'General' }));
    await waitFor(() => expect(body.getByRole('radio', { name: 'Date' })).toBeChecked());

    // Sort change round-trips through the store stub.
    await userEvent.click(body.getByRole('radio', { name: 'Name' }));
    await waitFor(() => expect(body.getByRole('radio', { name: 'Name' })).toBeChecked());

    // Appearance: dark on, Light rendered but disabled, hint present.
    await expect(body.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expect(body.getByRole('radio', { name: 'Light' })).toBeDisabled();
    await expect(body.getByText("Dark only for now — a light theme isn't part of the design system yet.")).toBeVisible();

    // Thumbnails: locked on with the rationale.
    await expect(body.getByRole('switch')).toBeChecked();
    await expect(body.getByRole('switch')).toBeDisabled();
    await expect(body.getByText('The grid browses thumbnails, even offline. Cannot be disabled.')).toBeVisible();
  },
};
