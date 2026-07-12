import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { PhotoTile } from './PhotoTile';
import type { SyncState } from './StatusGlyph';

const meta: Meta<typeof PhotoTile> = {
  title: 'Media/PhotoTile',
  component: PhotoTile,
};

export default meta;
type Story = StoryObj<typeof PhotoTile>;

// Inline gradient placeholder — the design bundle's thumbs are generated
// gradients too; a data URI keeps stories network-free.
const THUMB =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c4a5e"/><stop offset="1" stop-color="#0e1c26"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/></svg>',
  );

const STATUSES: readonly SyncState[] = ['local', 'synced', 'syncing', 'offloaded', 'error'];

function Matrix(): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 120px)',
        gap: 'var(--grid-gap)',
        padding: 'var(--space-7)',
      }}
    >
      {STATUSES.map((status) => (
        <div key={status} style={{ aspectRatio: '1' }}>
          <PhotoTile src={THUMB} alt={status} status={status} />
        </div>
      ))}
      {STATUSES.map((status) => (
        <div key={`sel-${status}`} style={{ aspectRatio: '1' }}>
          <PhotoTile src={THUMB} alt={`${status} selected`} status={status} selected favorite />
        </div>
      ))}
    </div>
  );
}

export const StateMatrix: Story = {
  render: () => <Matrix />,
};

export const ClickTargetsAreIndependent: Story = {
  args: {
    src: THUMB,
    alt: 'IMG_4021.RAF',
    onClick: fn(),
    onToggleSelect: fn(),
  },
  render: (args) => (
    <div style={{ width: 160, height: 160, padding: 'var(--space-7)', boxSizing: 'content-box' }}>
      <PhotoTile {...args} />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Circle click selects but never opens.
    await userEvent.click(canvas.getByRole('button', { name: 'Select' }));
    await expect(args.onToggleSelect).toHaveBeenCalledOnce();
    await expect(args.onClick).not.toHaveBeenCalled();
    // Tile click opens without toggling selection.
    await userEvent.click(canvas.getByRole('button', { name: 'Open IMG_4021.RAF' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
    await expect(args.onToggleSelect).toHaveBeenCalledOnce();
  },
};
