import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { OffloadDialog } from './OffloadDialog';

const photoIds = ['photo-ready', 'photo-local'];

function installStub(): void {
  (globalThis as { overlook?: unknown }).overlook = {
    backup: {
      offloadPreflight: () =>
        Promise.resolve({
          requested: 2,
          eligible: 1,
          ineligible: 1,
          estimatedFreedBytes: 8_400_000,
          items: [
            { photoId: 'photo-ready', eligible: true, bytes: 8_400_000, reason: null },
            { photoId: 'photo-local', eligible: false, bytes: 0, reason: 'local' },
          ],
        }),
      offload: () =>
        Promise.resolve({
          requested: 2,
          offloaded: 1,
          skipped: 1,
          failed: 0,
          freedBytes: 8_400_000,
          results: [
            { photoId: 'photo-ready', outcome: 'offloaded', bytes: 8_400_000, reason: null },
            { photoId: 'photo-local', outcome: 'skipped', bytes: 0, reason: 'local' },
          ],
        }),
    },
  };
}

const meta: Meta<typeof OffloadDialog> = {
  title: 'Backup/OffloadDialog',
  component: OffloadDialog,
  decorators: [
    (Story) => {
      installStub();
      return <Story />;
    },
  ],
  args: { photoIds, onClose: fn(), onComplete: fn() },
};

export default meta;
type Story = StoryObj<typeof OffloadDialog>;

export const MixedPreflightAndCompletion: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('1 original')).toBeVisible();
    await expect(canvas.getByText('ESTIMATED SPACE FREED · 8.4 MB')).toBeVisible();
    await expect(canvas.getByText('1 · not backed up yet')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Offload 1' }));
    await expect(args.onComplete).toHaveBeenCalledTimes(1);
  },
};
