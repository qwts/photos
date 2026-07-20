import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { PurgeConfirm } from './PurgeConfirm';

const meta: Meta<typeof PurgeConfirm> = {
  title: 'Grid/PurgeConfirm',
  component: PurgeConfirm,
};

export default meta;
type Story = StoryObj<typeof PurgeConfirm>;

export const ExactIrreversibleCeremony: Story = {
  args: { count: 2, onCancel: fn(), onConfirm: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole('dialog', { name: 'Delete 2 photos permanently?' });
    await expect(dialog).toHaveTextContent('local originals, previews, metadata, and connected-provider copies');
    await expect(dialog).toHaveTextContent('Cloud deletion failures are recorded and retried');
    await expect(dialog).toHaveTextContent('This cannot be undone.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};
