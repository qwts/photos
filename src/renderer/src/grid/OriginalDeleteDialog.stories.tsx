import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { OriginalDeleteDialog } from './OriginalDeleteDialog';

const onDeleted = fn();

function installStub(): void {
  (globalThis as { overlook?: unknown }).overlook = {
    library: {
      originalDeletePreflight: () =>
        Promise.resolve({
          challengeId: 'challenge-a',
          count: 1,
          protected: 1,
          fileName: 'IMG_4021.RAF',
          passwordRequired: false,
          expiresAt: '2026-07-21T12:02:00.000Z',
        }),
      originalDeleteCommit: () => Promise.resolve({ purged: 1, skipped: 0, protected: 0, remoteFailures: 0 }),
      originalDeleteCancel: () => Promise.resolve(),
    },
  };
}

function installPasswordStub(): void {
  (globalThis as { overlook?: unknown }).overlook = {
    library: {
      originalDeletePreflight: () =>
        Promise.resolve({
          challengeId: 'challenge-password',
          count: 2,
          protected: 1,
          fileName: null,
          passwordRequired: true,
          expiresAt: '2026-07-21T12:02:00.000Z',
        }),
      originalDeleteAuthorize: ({ password }: { password: string }) =>
        Promise.resolve(
          password === 'correct password' ? { ok: true as const } : { ok: false as const, reason: 'wrong-password' as const },
        ),
      originalDeleteCommit: () => Promise.resolve({ purged: 2, skipped: 0, protected: 0, remoteFailures: 0 }),
      originalDeleteCancel: () => Promise.resolve(),
    },
  };
}

const meta: Meta<typeof OriginalDeleteDialog> = {
  title: 'Grid/OriginalDeleteDialog',
  component: OriginalDeleteDialog,
  decorators: [
    (Story) => {
      installStub();
      return <Story />;
    },
  ],
};

export default meta;
type Story = StoryObj<typeof OriginalDeleteDialog>;

export const FinalConfirmation: Story = {
  args: { photoIds: ['P1'], onClose: fn(), onDeleted },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(await canvas.findByRole('heading', { name: 'Delete IMG_4021.RAF permanently?' })).toBeVisible();
    await expect(canvas.getByText(/overrides Original protection/u)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Delete permanently' }));
    await expect(onDeleted).toHaveBeenCalledWith({ purged: 1, skipped: 0, protected: 0, remoteFailures: 0 });
  },
};

export const PasswordAndError: Story = {
  args: { photoIds: ['P1', 'P2'], onClose: fn(), onDeleted: fn() },
  render: (args) => {
    installPasswordStub();
    return <OriginalDeleteDialog {...args} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const dialog = await canvas.findByRole('dialog', { name: 'Authenticate Original deletion' });
    await userEvent.type(within(dialog).getByLabelText('App password'), 'wrong password');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Authenticate' }));
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('incorrect');
    await userEvent.clear(within(dialog).getByLabelText('App password'));
    await userEvent.type(within(dialog).getByLabelText('App password'), 'correct password');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Authenticate' }));
    await expect(await canvas.findByRole('heading', { name: 'Delete 2 photos permanently?' })).toBeVisible();
  },
};

export const Cancellation: Story = {
  args: { photoIds: ['P1'], onClose: fn(), onDeleted: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await canvas.findByRole('heading', { name: 'Delete IMG_4021.RAF permanently?' });
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
