import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import realPhoto from '../../../../design/handoff/assets/thumbs/t02.png';
import type { PhotoRecord, SyncStatus } from '../../../shared/library/types.js';
import { ListRow } from './ListRow';

const meta: Meta<typeof ListRow> = {
  title: 'Grid/ListRow',
  component: ListRow,
};

export default meta;
type Story = StoryObj<typeof ListRow>;

function photo(index: number, syncState: SyncStatus, favorite = false): PhotoRecord {
  return {
    id: `P${index}`,
    fileName: `IMG_${4021 + index}.JPG`,
    fileKind: 'jpeg',
    width: 6240,
    height: 4160,
    bytes: 24_600_000,
    contentHash: `hash-${index}`,
    camera: 'FUJIFILM X-T5',
    lens: null,
    iso: null,
    aperture: null,
    shutter: null,
    focalLength: null,
    takenAt: '2026-06-12T12:00:00.000Z',
    gpsLat: null,
    gpsLon: null,
    place: 'Lisbon',
    importedAt: '2026-07-01T00:00:00.000Z',
    importSource: 'story',
    favorite,
    keyId: 1,
    deletedAt: null,
    previewFailure: null,
    syncState,
  };
}

const STATES: readonly SyncStatus[] = ['local', 'synced', 'syncing', 'offloaded'];

function Matrix(): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--space-3)', maxWidth: 720 }}>
      {STATES.map((syncState, index) => (
        <div key={syncState} style={{ height: 52 }}>
          <ListRow photo={photo(index, syncState, index === 0)} src={realPhoto} selected={false} onOpen={fn()} onToggleSelect={fn()} />
        </div>
      ))}
      <div style={{ height: 52 }}>
        <ListRow photo={photo(9, 'synced', true)} src={realPhoto} selected onOpen={fn()} onToggleSelect={fn()} />
      </div>
    </div>
  );
}

export const StateMatrix: Story = {
  render: () => <Matrix />,
};

const onOpen = fn();
const onToggle = fn();

// Same contract as PhotoTile (#77): the circle toggles without opening.
export const ClickTargetsAreIndependent: Story = {
  render: () => (
    <div style={{ height: 52, maxWidth: 720, padding: 'var(--space-3)' }}>
      <ListRow photo={photo(0, 'synced')} src={realPhoto} selected={false} onOpen={onOpen} onToggleSelect={onToggle} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByRole('button', { name: 'Open IMG_4021.JPG' });
    const circle = within(row).getByRole('button', { name: 'Select' });
    await userEvent.click(circle);
    await expect(onToggle).toHaveBeenCalledTimes(1);
    await expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(row);
    await expect(onOpen).toHaveBeenCalledTimes(1);
  },
};
