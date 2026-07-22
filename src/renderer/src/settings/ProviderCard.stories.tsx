import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';

import { ProviderCard, type ProviderCardProps } from './ProviderCard';

// Per-state gallery for the #684 provider storage card. Each story is one state
// from the design spec's state gallery; the story lane runs axe over every one.

const base: ProviderCardProps = {
  name: 'iCloud Drive',
  connection: 'connected',
  account: 'm.rivera@icloud.com',
  usage: { bytes: 51_742_097_408, failed: false, stale: false, staleLabel: null },
  capacity: { kind: 'none' },
  capabilitiesLine: 'Verify by download · restarts interrupted uploads',
  message: 'Link a provider to store encrypted originals off-device.',
  announcement: null,
  primaryLabel: 'Disconnect provider',
  primaryVariant: 'secondary',
  primaryDisabled: false,
  onPrimary: fn(),
  canRefresh: true,
  refreshLabel: 'Refresh',
  onRefresh: fn(),
  onCapacityRoute: fn(),
};

const meta: Meta<typeof ProviderCard> = {
  title: 'Settings/ProviderCard',
  component: ProviderCard,
  args: base,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560, padding: 'var(--space-6)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ProviderCard>;

// iCloud: measured usage + the honest System Settings capacity route, no bar.
export const ICloudUsedWithCapacityRoute: Story = {
  args: { capacity: { kind: 'route' } },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText('Used by Overlook')).toBeVisible();
    await expect(card.getByRole('button', { name: /View in System Settings/u })).toBeVisible();
    await expect(card.queryByRole('progressbar')).not.toBeInTheDocument();
    // The exact byte count rides in the value's accessible name even though the
    // visible text is abbreviated.
    await expect(card.getByText('51.7 GB')).toHaveAttribute('aria-label', expect.stringContaining('51,742,097,408 bytes'));
  },
};

// Google Drive: measured usage distinct from account-wide verified capacity (bar).
export const GoogleDriveKnownCapacity: Story = {
  args: {
    name: 'Google Drive',
    account: 'm.rivera@gmail.com',
    usage: { bytes: 12_400_000_000, failed: false, stale: false, staleLabel: null },
    capacity: { kind: 'known', usedBytes: 42_000_000_000, totalBytes: 2_000_000_000_000 },
    capabilitiesLine: 'Server checksum · resumable uploads',
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText('Used by Overlook')).toBeVisible();
    await expect(card.getByRole('progressbar')).toBeInTheDocument();
    await expect(card.getByText(/of 2 TB used/u)).toBeVisible();
  },
};

export const PCloudKnownCapacity: Story = {
  args: {
    name: 'pCloud',
    account: 'm.rivera@pcloud.com',
    usage: { bytes: 380_000_000_000, failed: false, stale: false, staleLabel: null },
    capacity: { kind: 'known', usedBytes: 380_000_000_000, totalBytes: 500_000_000_000 },
    capabilitiesLine: 'Server checksum · resumable uploads',
  },
};

// Connected, first measurement still running.
export const MeasuringUsage: Story = {
  args: {
    usage: { bytes: null, failed: false, stale: false, staleLabel: null },
    capacity: { kind: 'route' },
    announcement: 'Measuring iCloud Drive backup usage…',
  },
};

// Last-known figure retained, marked stale — connection authority unchanged.
export const OfflineStale: Story = {
  args: {
    usage: {
      bytes: 51_742_097_408,
      failed: false,
      stale: true,
      staleLabel: 'Last measured 2 hours ago · offline',
    },
    capacity: { kind: 'route' },
    refreshLabel: 'Retry',
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText('Last measured 2 hours ago · offline')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  },
};

// Measurement failed with no retained figure — actionable, never a fake number.
export const CalculationFailure: Story = {
  args: {
    usage: { bytes: null, failed: true, stale: false, staleLabel: null },
    capacity: { kind: 'route' },
    refreshLabel: 'Try again',
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText('Couldn’t measure usage right now.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  },
};

// A known-quota provider whose quota call failed: used figure, no bar, no route.
export const CapacityUnavailable: Story = {
  args: {
    name: 'pCloud',
    account: 'm.rivera@pcloud.com',
    usage: { bytes: 380_000_000_000, failed: false, stale: false, staleLabel: null },
    capacity: { kind: 'unavailable' },
  },
};

export const CheckingConnection: Story = {
  args: {
    connection: 'checking',
    account: null,
    primaryLabel: 'Checking…',
    primaryDisabled: true,
    canRefresh: false,
  },
};

export const Disconnected: Story = {
  args: {
    connection: 'disconnected',
    account: null,
    primaryLabel: 'Connect iCloud Drive',
    primaryVariant: 'primary',
    canRefresh: false,
  },
};

export const StatusUnavailable: Story = {
  args: {
    connection: 'error',
    account: null,
    primaryLabel: 'Try again',
    canRefresh: false,
  },
};
