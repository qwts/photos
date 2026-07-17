import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import realPhoto from '../../../../design/handoff/assets/thumbs/t01.png';
import { PhotoTile } from './PhotoTile';
import type { SyncState } from './StatusGlyph';

const meta: Meta<typeof PhotoTile> = {
  title: 'Media/PhotoTile',
  component: PhotoTile,
};

export default meta;
type Story = StoryObj<typeof PhotoTile>;

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
          <PhotoTile src={realPhoto} alt={status} status={status} />
        </div>
      ))}
      {STATUSES.map((status) => (
        <div key={`sel-${status}`} style={{ aspectRatio: '1' }}>
          <PhotoTile src={realPhoto} alt={`${status} selected`} status={status} selected favorite />
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
    src: realPhoto,
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

export const PreviewUnavailable: Story = {
  args: {
    src: 'data:image/jpeg;base64,AA==',
    alt: 'unsupported.NEF',
  },
  render: (args) => (
    <div style={{ width: 160, height: 160, padding: 'var(--space-7)', boxSizing: 'content-box' }}>
      <PhotoTile {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('PREVIEW UNAVAILABLE'));
    await expect(canvasElement.querySelector('img')).toHaveAttribute('data-unavailable', 'true');
  },
};
