import { useState, type ReactElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import type { OverlookApi } from '../../../shared/ipc/api.js';
import { ProtectedAlbumCeremony } from './ProtectedAlbumCeremony';

type Behavior = 'success' | 'conflict' | 'failure' | 'progress';

function installStub(behavior: Behavior): void {
  const result =
    behavior === 'conflict'
      ? { ok: false as const, albumId: null, reason: 'conflict' as const }
      : behavior === 'failure'
        ? { ok: false as const, albumId: null, reason: 'failed' as const }
        : { ok: true as const, albumId: 'opaque-protected-id', reason: null };
  let progressListener: ((progress: Parameters<Parameters<OverlookApi['protectedAlbums']['onProgress']>[0]>[0]) => void) | null = null;
  const protectedAlbums = {
    protect: () => {
      if (behavior !== 'progress') return Promise.resolve(result);
      progressListener?.({ operation: 'protect', stage: 'copying', done: 2, total: 8 });
      return new Promise<never>(() => undefined);
    },
    unlock: () => Promise.resolve({ ok: false, outcome: null }),
    changePassword: () => Promise.resolve({ changed: false }),
    unprotect: () => Promise.resolve({ ok: false, albumId: null, reason: 'failed' }),
    pickRecovery: () => Promise.resolve({ path: '/Users/ansel/Desktop/overlook-recovery.key' }),
    recover: () => Promise.resolve({ recovered: false, reason: 'wrong-recovery-key' }),
    cancelWorkflow: () => Promise.resolve({ cancelled: true }),
    onProgress: (listener: typeof progressListener) => {
      progressListener = listener;
      return () => {
        progressListener = null;
      };
    },
  } as unknown as OverlookApi['protectedAlbums'];
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = { protectedAlbums };
}

function CompletionStory(): ReactElement {
  const [message, setMessage] = useState<string | null>(null);
  installStub('success');
  if (message !== null) {
    return (
      <div className="ovl-keynote ovl-keynote--green" role="status">
        {message}
      </div>
    );
  }
  return <ProtectedAlbumCeremony mode="protect" albumId="family" albumName="Family" onClose={fn()} onComplete={setMessage} />;
}

const meta: Meta<typeof ProtectedAlbumCeremony> = {
  title: 'App/ProtectedAlbumCeremony',
  component: ProtectedAlbumCeremony,
  args: { mode: 'protect', albumId: 'family', albumName: 'Family', onClose: fn(), onComplete: fn() },
};

export default meta;
type Story = StoryObj<typeof ProtectedAlbumCeremony>;

const enterStrongPassword = async (body: ReturnType<typeof within>): Promise<void> => {
  await userEvent.type(body.getByLabelText('New protected album password'), 'Correct Horse Battery Staple 42!');
  await userEvent.type(body.getByLabelText('Confirm protected album password'), 'Correct Horse Battery Staple 42!');
};

export const PasswordStrengthAndConfirmation: Story = {
  render: (args) => {
    installStub('success');
    return <ProtectedAlbumCeremony {...args} />;
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const action = body.getByRole('button', { name: 'Protect album' });
    await expect(action).toBeDisabled();
    await enterStrongPassword(body);
    await expect(body.getByText('Very strong')).toBeVisible();
    await expect(action).toBeEnabled();
  },
};

export const MigrationProgressAndSafeCancel: Story = {
  render: (args) => {
    installStub('progress');
    return <ProtectedAlbumCeremony {...args} />;
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await enterStrongPassword(body);
    await userEvent.click(body.getByRole('button', { name: 'Protect album' }));
    await waitFor(() => expect(body.getByText('Protecting · copying')).toBeVisible());
    await expect(body.getByText('2 / 8')).toBeVisible();
    await expect(body.getByRole('button', { name: 'Cancel safely' })).toBeEnabled();
  },
};

export const ConflictIsHonest: Story = {
  render: (args) => {
    installStub('conflict');
    return <ProtectedAlbumCeremony {...args} />;
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await enterStrongPassword(body);
    await userEvent.click(body.getByRole('button', { name: 'Protect album' }));
    await waitFor(() =>
      expect(body.getByText('Another migration is active, or the original album destination already exists.')).toBeVisible(),
    );
  },
};

export const CompletionState: Story = {
  render: () => <CompletionStory />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await enterStrongPassword(body);
    await userEvent.click(body.getByRole('button', { name: 'Protect album' }));
    await waitFor(() => expect(body.getByRole('status')).toHaveTextContent('Album protected and relocked'));
  },
};

export const RecoveryFileAndNewCredential: Story = {
  args: { mode: 'recover', albumId: 'opaque-protected-id', albumName: undefined },
  render: (args) => {
    installStub('success');
    return <ProtectedAlbumCeremony {...args} />;
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'Choose…' }));
    await waitFor(() => expect(body.getByText('overlook-recovery.key')).toBeVisible());
    await expect(body.getByLabelText('Recovery file password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(body.getByLabelText('New protected album password')).toHaveAttribute('autocomplete', 'new-password');
  },
};
