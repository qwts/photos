import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SettingsDialog } from './SettingsDialog';
import { defaultSettings, mergeSettings, type AppSettings } from '../../../shared/settings/settings.js';
import type { OverlookApi } from '../../../shared/ipc/api.js';
import { AppStateProvider } from '../state/app-state-context';

// #112–#114 exit criteria: the 640px two-pane frame (Storage & Backup opens
// by default, nav switches panes, keyboard-operable, Esc closes), the
// General section (sort segmented wired to the store stub, Light disabled
// with the dark-only hint, thumbnails locked on), and the Storage & Backup
// section (connection card + disconnected-disables-everything). The
// decorator installs in-memory window.overlook settings + backup stubs.

interface StoryWindow extends Window {
  releaseInitialProviderStatus?: () => void;
}

function installStub(options?: { readonly deferInitialProviderStatus?: boolean }): void {
  let current: AppSettings = { ...defaultSettings };
  const mockProvider = {
    id: 'mock',
    label: 'Local mock',
    capabilities: {
      quota: 'known' as const,
      verification: 'server-checksum' as const,
      resumableUpload: false,
      platforms: ['darwin' as const],
      interactiveAuth: false,
      reconnectRequired: false,
    },
    available: true,
    unavailableReason: null,
  };
  const archiveProvider = {
    id: 'archive-cloud',
    label: 'Archive Cloud',
    capabilities: {
      quota: 'unknown' as const,
      verification: 'download-hash' as const,
      resumableUpload: false,
      platforms: ['darwin' as const],
      interactiveAuth: false,
      reconnectRequired: false,
    },
    available: true,
    unavailableReason: null,
  };
  const googleDriveProvider = {
    id: 'google-drive',
    label: 'Google Drive',
    capabilities: {
      quota: 'known' as const,
      verification: 'server-checksum' as const,
      resumableUpload: true,
      platforms: ['darwin' as const, 'win32' as const, 'linux' as const],
      interactiveAuth: true,
      reconnectRequired: true,
    },
    available: true,
    unavailableReason: null,
  };
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
  const initialProviderStatus =
    options?.deferInitialProviderStatus === true
      ? new Promise<void>((resolve) => {
          (globalThis as unknown as StoryWindow).releaseInitialProviderStatus = resolve;
        })
      : Promise.resolve();
  let providerStatusRequests = 0;
  const backupApi: OverlookApi['backup'] = {
    run: () =>
      Promise.resolve({
        uploaded: 0,
        failed: 0,
        skipped: null,
        integrity: { checked: 0, repaired: 0, unrecoverable: 0, recoveryRepaired: false, failed: false },
      }),
    onProgress: () => () => undefined,
    onCompleted: () => () => undefined,
    offloadPreflight: () => Promise.resolve({ eligible: 0, ineligible: 0, estimatedFreedBytes: 0, items: [] }),
    offload: () => Promise.resolve({ offloaded: 0, skipped: 0, failed: 0, freedBytes: 0, results: [] }),
    rehydrate: () => Promise.resolve({ ok: true }),
    keepDownloaded: () => Promise.resolve({ ok: true }),
    releaseEphemeral: () => Promise.resolve({ ok: true }),
    ephemeralStatus: () => Promise.resolve({ stage: null }),
    prepareEphemeral: () => Promise.resolve({ custody: 'ephemeral' }),
    onEphemeralState: () => () => undefined,
    restoreOriginals: ({ photoIds }) =>
      Promise.resolve({
        restored: photoIds?.length ?? 2,
        skipped: 0,
        failed: 0,
        results: (photoIds ?? ['offloaded-1', 'offloaded-2']).map((photoId) => ({
          photoId,
          outcome: 'restored' as const,
          bytes: 6_300_000_000,
          reason: null,
        })),
      }),
    providers: () => Promise.resolve({ providers: [mockProvider, googleDriveProvider, archiveProvider], defaultProviderId: 'mock' }),
    // The card's truth follows the stub store's providerId, like main does.
    providerStatus: async ({ providerId }) => {
      // Keep status observably asynchronous so the story proves the pane's
      // unresolved state without relying on a same-microtask response.
      const initialRequest = providerStatusRequests === 0;
      providerStatusRequests += 1;
      if (initialRequest) await initialProviderStatus;
      const provider =
        providerId === archiveProvider.id ? archiveProvider : providerId === googleDriveProvider.id ? googleDriveProvider : mockProvider;
      return current.providerId !== providerId
        ? { provider, connected: false, account: null, usedBytes: null, totalBytes: null }
        : providerId === archiveProvider.id
          ? { provider, connected: true, account: null, usedBytes: null, totalBytes: null }
          : providerId === googleDriveProvider.id
            ? { provider, connected: true, account: null, usedBytes: 42_000_000_000, totalBytes: 100_000_000_000 }
            : { provider, connected: true, account: null, usedBytes: 380_000_000_000, totalBytes: 500_000_000_000 };
    },
    // Connect/disconnect (#254) mirror main's mock policy: flip providerId.
    connect: ({ providerId }) => {
      apply({ providerId });
      return Promise.resolve({ ok: true, reason: null });
    },
    disconnect: () => {
      apply({ providerId: null });
      return Promise.resolve({ ok: true, reason: null });
    },
  };
  const keysApi = {
    status: () => Promise.resolve({ fingerprint: '9F2C·4A81·D0E7·5B3A' }),
    export: () => Promise.resolve({ path: null }),
    pickFile: () => Promise.resolve({ path: null }),
    import: () => Promise.resolve({ installed: false, fingerprint: null, reason: 'invalid' as const }),
  } as unknown as OverlookApi['keys'];
  const restoreApi: OverlookApi['restore'] = {
    profileStatus: () => Promise.resolve({ fresh: false }),
    pickKey: () => Promise.resolve({ path: '/Users/ansel/Desktop/overlook-recovery.key' }),
    discover: () =>
      Promise.resolve({
        sessionId: 'story-session',
        libraries: [
          {
            libraryId: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
            generation: 7,
            generatedAt: '2026-07-14T23:00:00.000Z',
            photos: 1542,
            totalBytes: 48_000_000_000,
            albums: 12,
            compatibility: 'compatible',
            validation: 'valid',
            fallbackGenerations: 1,
            resumable: true,
          },
        ],
        error: null,
      }),
    run: () =>
      Promise.resolve({
        result: {
          libraryId: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
          generation: 7,
          photos: 1542,
          resumed: true,
          fallbackFromGeneration: 9,
          relaunching: true,
        },
        error: null,
      }),
    cancel: () => Promise.resolve({}),
    onProgress: () => () => undefined,
  };
  const appLockListeners = new Set<Parameters<OverlookApi['appLock']['onChanged']>[0]>();
  const appLockApi: OverlookApi['appLock'] = {
    status: () => Promise.resolve({ state: 'unconfigured-unlocked', libraryId: null, retryAfterMs: 0 }),
    unlock: () => Promise.resolve({ ok: true, reason: null, retryAfterMs: 0 }),
    configure: () => Promise.resolve({ state: 'locked', libraryId: 'story-library', retryAfterMs: 0 }),
    lockNow: () => Promise.resolve({ state: 'locked', libraryId: 'story-library', retryAfterMs: 0 }),
    changePassword: () => Promise.resolve({ changed: true }),
    remove: () => Promise.resolve({ removed: true }),
    pickRecovery: () => Promise.resolve({ path: null }),
    recover: () => Promise.resolve({ recovered: false, reason: 'invalid' }),
    touchIdStatus: () => Promise.resolve({ available: false, reason: 'unsigned-build', enabled: false, reenrollmentRequired: false }),
    touchIdEnable: () => Promise.resolve({ enabled: false, reason: 'unsigned-build' }),
    touchIdDisable: () => Promise.resolve({ disabled: true }),
    touchIdUnlock: () => Promise.resolve({ ok: false, reason: 'not-enabled' }),
    onChanged: (listener) => {
      appLockListeners.add(listener);
      return () => appLockListeners.delete(listener);
    },
    onTouchIdChanged: () => () => undefined,
  };
  let diagnosticReports: Awaited<ReturnType<OverlookApi['diagnostics']['list']>>['reports'] = [
    {
      eventId: '98f581d6-ef9a-45e2-ae19-8b90099aef2e',
      capturedAt: '2026-07-17T10:00:00.000Z',
      kind: 'renderer-process-gone',
      payload:
        '{"schemaVersion":1,"eventId":"98f581d6-ef9a-45e2-ae19-8b90099aef2e","capturedAt":"2026-07-17T10:00:00.000Z","appVersion":"0.27.0","platform":"darwin","arch":"arm64","kind":"renderer-process-gone","reason":"crashed","exitCode":5}',
      encryptedBytes: 384,
    },
  ];
  const diagnosticsApi: OverlookApi['diagnostics'] = {
    list: () => Promise.resolve({ reports: diagnosticReports }),
    delete: ({ eventId }) => {
      const deleted = diagnosticReports.some((report) => report.eventId === eventId);
      diagnosticReports = diagnosticReports.filter((report) => report.eventId !== eventId);
      return Promise.resolve({ deleted });
    },
    purge: () => {
      const deleted = diagnosticReports.length;
      diagnosticReports = [];
      return Promise.resolve({ deleted });
    },
    export: () => Promise.resolve({ exported: true, count: diagnosticReports.length }),
  };
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = {
    settings: settingsApi,
    backup: backupApi,
    keys: keysApi,
    restore: restoreApi,
    appLock: appLockApi,
    diagnostics: diagnosticsApi,
    library: {
      albums: () => Promise.resolve({ albums: [{ id: 'family', name: 'Family', count: 4 }] }),
      stats: () => Promise.resolve({ photos: 1542, bytes: 48_000_000_000, pending: 0, lastBackupAt: null, offloadedBytes: 12_600_000_000 }),
      onChanged: () => () => undefined,
      onPendingCountChanged: () => () => undefined,
      onStorageChanged: () => () => undefined,
    } as unknown as OverlookApi['library'],
    protectedAlbums: {
      list: () => Promise.resolve({ albums: [] }),
      onChanged: () => () => undefined,
    } as unknown as OverlookApi['protectedAlbums'],
  };
}

const meta: Meta<typeof SettingsDialog> = {
  title: 'App/SettingsDialog',
  component: SettingsDialog,
  args: { open: true, onClose: fn(), selectedPhotoIds: ['offloaded-1', 'offloaded-2'] },
  decorators: [
    (Story) => {
      installStub();
      return (
        <AppStateProvider>
          <Story />
        </AppStateProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof SettingsDialog>;

export const StorageOpensByDefault: Story = {
  decorators: [
    (Story) => {
      installStub({ deferInitialProviderStatus: true });
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    const storage = body.getByRole('button', { name: 'Storage & Backup' });
    await expect(storage).toHaveAttribute('aria-current', 'true');
    // A slow provider check stays neutral: never claim the selected provider
    // is disconnected or offer connection actions before truth resolves.
    await waitFor(() => expect(body.getByText('Checking connection…')).toBeVisible());
    await expect(body.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    await expect(body.queryByText('Not connected')).not.toBeInTheDocument();
    await expect(body.queryByText('Link a provider to store encrypted originals off-device.')).not.toBeInTheDocument();
    const storyWindow = canvasElement.ownerDocument.defaultView as StoryWindow | null;
    if (storyWindow?.releaseInitialProviderStatus === undefined) throw new Error('expected deferred provider status');
    storyWindow.releaseInitialProviderStatus();
    // The real pane (#114): connected card with live quota + enabled knobs.
    await waitFor(() => expect(body.getByText('Connected')).toBeVisible());
    await expect(body.getByText('THIS DEVICE · 380 GB / 500 GB USED')).toBeVisible();
    await expect(body.getByText('Back up new imports automatically')).toBeVisible();
    await expect(body.getByText('12.6 GB stored only in your verified cloud backup. Thumbnails remain on this Mac.')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Restore selected (2)' }));
    await waitFor(() => expect(body.getByText('2 restored')).toBeVisible());
  },
};

export const DisconnectHidesBackupControls: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('button', { name: 'Disconnect' })).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Disconnect' }));

    // Updated design (#239): the backup-specific controls HIDE instead of
    // disabling — only the connection card, re-offload policy, import
    // Copy/Move (no provider needed), and the locked Encrypt switch remain.
    await waitFor(() => expect(body.getByText('Not connected')).toBeVisible());
    await expect(body.getByText('Link a provider to store encrypted originals off-device.')).toBeVisible();
    await expect(body.queryByText('Back up new imports automatically')).not.toBeInTheDocument();
    await expect(body.queryByText('Wi-Fi only')).not.toBeInTheDocument();
    await expect(body.queryByRole('slider', { name: 'Upload bandwidth limit' })).not.toBeInTheDocument();
    await expect(body.getByRole('radio', { name: 'Copy' })).toBeEnabled();
    await expect(body.getByRole('radio', { name: 'Move' })).toBeEnabled();
    // Re-offload remains a user policy while disconnected; Encrypt is locked on.
    const switches = body.getAllByRole('switch');
    await expect(switches).toHaveLength(2);
    await expect(switches[0]).toBeEnabled();
    await expect(switches[1]).toBeDisabled();

    // Reconnect: instant with the mock, quota and the knobs return.
    await userEvent.click(body.getByRole('button', { name: 'Connect Local mock' }));
    await waitFor(() => expect(body.getByText('Connected')).toBeVisible());
    await expect(body.getByText('THIS DEVICE · 380 GB / 500 GB USED')).toBeVisible();
    await expect(body.getByText('Back up new imports automatically')).toBeVisible();
  },
};

export const ProviderSelectionAndUnknownQuota: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('button', { name: 'Disconnect' })).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(await waitFor(() => body.getByRole('radio', { name: 'Archive Cloud' })));
    await userEvent.click(body.getByRole('button', { name: 'Connect Archive Cloud' }));
    await waitFor(() => expect(body.getByText('THIS DEVICE · STORAGE USAGE NOT REPORTED')).toBeVisible());
    await expect(body.getByText(/VERIFY BY DOWNLOAD/u)).toBeVisible();
  },
};

export const GoogleDriveSelection: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('button', { name: 'Disconnect' })).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(await waitFor(() => body.getByRole('radio', { name: 'Google Drive' })));
    await userEvent.click(body.getByRole('button', { name: 'Connect Google Drive' }));
    await waitFor(() => expect(body.getByText('THIS DEVICE · 42 GB / 100 GB USED')).toBeVisible());
    await expect(body.getByText(/SERVER CHECKSUM · RESUMABLE UPLOADS/u)).toBeVisible();
  },
};

export const RestoreDiscoveryAndWarnings: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const restoreButton = await waitFor(() => body.getByRole('button', { name: 'Restore library…' }));
    await userEvent.click(restoreButton);
    await expect(body.getByRole('dialog', { name: 'Restore from cloud backup' })).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Choose recovery key' }));
    await userEvent.type(body.getByLabelText('Recovery-key password'), 'correct horse battery staple');
    await userEvent.click(body.getByRole('button', { name: 'Discover backups' }));
    await waitFor(() => expect(body.getByTestId('restore-library-card')).toHaveTextContent('1,542 PHOTOS'));
    await expect(body.getByText('1 retained fallback generation available')).toBeVisible();
    await expect(body.getByText('Verified staged work is ready to resume')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Review restore' }));
    await expect(body.getByText('This replaces the active library.')).toBeVisible();
    await expect(body.getByRole('button', { name: 'Restore 1,542 photos' })).toBeDisabled();
    await userEvent.click(body.getByRole('checkbox'));
    await expect(body.getByRole('button', { name: 'Restore 1,542 photos' })).toBeEnabled();
    await userEvent.click(body.getByRole('button', { name: 'Restore 1,542 photos' }));
    await waitFor(() => expect(body.getByText('Restore complete')).toBeVisible());
    await expect(body.getByText('Generation 9 failed validation; restored generation 7.')).toBeVisible();
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

export const TransferAndSyncAction: Story = {
  args: { onTransfer: fn() },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'Transfer & Sync' }));
    const action = await waitFor(() => body.getByRole('button', { name: 'Open Transfer & Sync' }));

    await expect(action).toHaveClass('ovl-button', 'ovl-button--primary', 'ovl-settings__transferAction');
    action.focus();
    await expect(action).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onTransfer).toHaveBeenCalledOnce();

    const pane = body.getByTestId('settings-pane');
    await expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(pane.getBoundingClientRect().right + 1);
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
    const switches = body.getAllByRole('switch');
    const faceGrouping = switches.at(-2);
    const diagnostics = switches.at(-1);
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
    await waitFor(() => expect(body.getByText('1 pending local report')).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: 'Review reports…' }));
    await expect(body.getByRole('dialog', { name: 'Review diagnostics' })).toBeVisible();
    await expect(body.getByText(/"kind":"renderer-process-gone"/u)).toBeVisible();
    await expect(body.getByText('Nothing is sent.', { exact: false })).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Export JSONL…' }));
    await expect(body.getByText('1 report exported.')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Delete' }));
    await expect(body.getByText('No reports are waiting locally.')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Done' }));
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
