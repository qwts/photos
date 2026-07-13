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
  // connect/disconnect (#254) mutate settings OUTSIDE the set() round-trip,
  // exactly like main does — so the stub must deliver change pushes too.
  const listeners = new Set<(payload: { settings: AppSettings }) => void>();
  const apply = (patch: Parameters<typeof mergeSettings>[1]): void => {
    current = mergeSettings(current, patch);
    for (const listener of listeners) {
      listener({ settings: current });
    }
  };
  const settingsApi: OverlookApi['settings'] = {
    get: () => Promise.resolve({ settings: current }),
    set: ({ patch }) => {
      apply(patch);
      return Promise.resolve({ settings: current });
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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
    // Connect/disconnect (#254) mirror main's mock policy: flip providerId.
    connect: () => {
      apply({ providerId: 'mock' });
      return Promise.resolve({ ok: true, reason: null });
    },
    disconnect: () => {
      apply({ providerId: null });
      return Promise.resolve({ ok: true as const });
    },
  };
  const keysApi = {
    status: () => Promise.resolve({ fingerprint: '9F2C·4A81·D0E7·5B3A' }),
    export: () => Promise.resolve({ path: null }),
    pickFile: () => Promise.resolve({ path: null }),
    import: () => Promise.resolve({ installed: false, fingerprint: null, reason: 'invalid' as const }),
  } as unknown as OverlookApi['keys'];
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = { settings: settingsApi, backup: backupApi, keys: keysApi };
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

export const DisconnectHidesBackupControls: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('button', { name: 'Disconnect' })).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Disconnect' }));

    // Updated design (#239): the backup-specific controls HIDE instead of
    // disabling — only the connection card, import Copy/Move (no provider
    // needed), and the locked Encrypt switch remain.
    await waitFor(() => expect(body.getByText('Not connected')).toBeVisible());
    await expect(body.getByText('Link a provider to store encrypted originals off-device.')).toBeVisible();
    await expect(body.queryByText('Back up new imports automatically')).not.toBeInTheDocument();
    await expect(body.queryByText('Wi-Fi only')).not.toBeInTheDocument();
    await expect(body.queryByRole('slider', { name: 'Upload bandwidth limit' })).not.toBeInTheDocument();
    await expect(body.getByRole('radio', { name: 'Copy' })).toBeEnabled();
    await expect(body.getByRole('radio', { name: 'Move' })).toBeEnabled();
    // The locked Encrypt switch is the one switch left, still disabled-on.
    const switches = body.getAllByRole('switch');
    await expect(switches).toHaveLength(1);
    await expect(switches[0]).toBeDisabled();

    // Reconnect: instant with the mock, quota and the knobs return.
    await userEvent.click(body.getByRole('button', { name: 'Connect Mock provider' }));
    await waitFor(() => expect(body.getByText('Connected')).toBeVisible());
    await expect(body.getByText('THIS DEVICE · 380 GB / 500 GB USED')).toBeVisible();
    await expect(body.getByText('Back up new imports automatically')).toBeVisible();
  },
};

export const NavSwitchesPanes: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'General' }));
    await expect(body.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(body.getByText('Default sort order')).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Privacy' }));
    await expect(body.getByText('End-to-end encryption')).toBeVisible();
  },
};

export const PrivacySection: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'Privacy' }));

    // Recovery key row (#240): fingerprint + both KeyDialog entry points.
    await waitFor(() => expect(body.getByTestId('recovery-key-row')).toHaveTextContent('9F2C·4A81·D0E7·5B3A'));
    await userEvent.click(body.getByRole('button', { name: 'Back up…' }));
    await expect(body.getByRole('dialog', { name: 'Back up encryption key' })).toBeVisible();
    // Stacked modals (PR #250 review): Escape closes ONLY the top dialog —
    // Settings stays open underneath.
    await userEvent.keyboard('{Escape}');
    await expect(body.queryByRole('dialog', { name: 'Back up encryption key' })).not.toBeInTheDocument();
    await expect(body.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Import…' }));
    await expect(body.getByRole('dialog', { name: 'Import encryption key' })).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }));

    // Factual, always-on encryption row.
    await waitFor(() => expect(body.getByText('Always on')).toBeVisible());
    await expect(body.getByText('Originals and thumbnails are encrypted on this device before leaving it.')).toBeVisible();

    // Face grouping is deferred — disabled and OFF, never faked as active.
    const [faceGrouping, diagnostics] = body.getAllByRole('switch');
    if (faceGrouping === undefined || diagnostics === undefined) {
      throw new Error('expected the face-grouping and diagnostics switches');
    }
    await expect(faceGrouping).toBeDisabled();
    await expect(faceGrouping).not.toBeChecked();
    await expect(body.getByText('Not yet available — will run entirely on-device when it ships.')).toBeVisible();

    // Diagnostics: off by default, honest local-only copy, persists via the
    // store stub.
    await expect(diagnostics).not.toBeChecked();
    await expect(
      body.getByText('Anonymous crash reports only — never photo content or metadata. Reporting stays local-only for now.'),
    ).toBeVisible();
    await userEvent.click(diagnostics);
    await waitFor(() => expect(diagnostics).toBeChecked());
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
