import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { QuickActions, type QuickActionItem } from './QuickActions';

const photoItems: readonly QuickActionItem[] = [
  {
    id: 'photo.favorite.toggle',
    label: 'Add to Favorites',
    icon: 'star',
    enabled: true,
    reason: null,
    targetLabel: 'This photo',
  },
  {
    id: 'photo.export',
    label: 'Export',
    icon: 'share',
    enabled: true,
    reason: null,
    targetLabel: 'Selection (3)',
  },
  {
    id: 'photo.restore',
    label: 'Restore photo',
    icon: 'refresh-cw',
    enabled: false,
    reason: 'Available only for photos in Trash',
    targetLabel: 'Selection (3)',
  },
];

const meta: Meta<typeof QuickActions> = {
  title: 'Library/Quick Actions',
  component: QuickActions,
  args: {
    photoName: 'IMG_4021.RAF',
    items: photoItems,
    onInvoke: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', width: 320, height: 180, background: 'var(--gray-2)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PhotoAndSelectionTargets: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toolbar = canvas.getByRole('toolbar', { name: 'Quick Actions for IMG_4021.RAF' });
    await expect(toolbar).toHaveTextContent('This photo / Selection (3)');
    await expect(canvas.getByRole('button', { name: 'Restore photo. Selection (3). Available only for photos in Trash' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Export. Selection (3)' }));
    await expect(args.onInvoke).toHaveBeenCalledWith('photo.export');
  },
};
