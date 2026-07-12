import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { PhotoRecord } from '../../../shared/library/types.js';
import { PhotoTile } from '../components/PhotoTile';
import { VirtualGrid } from './VirtualGrid';

const meta: Meta<typeof VirtualGrid> = {
  title: 'Grid/VirtualGrid',
  component: VirtualGrid,
};

export default meta;
type Story = StoryObj<typeof VirtualGrid>;

const THUMB =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c4a5e"/><stop offset="1" stop-color="#0e1c26"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/></svg>',
  );

function photo(index: number): PhotoRecord {
  return {
    id: `P${index}`,
    fileName: `IMG_${index}.JPG`,
    fileKind: 'jpeg',
    width: 200,
    height: 200,
    bytes: 1000,
    contentHash: `hash-${index}`,
    camera: null,
    lens: null,
    iso: null,
    aperture: null,
    shutter: null,
    focalLength: null,
    takenAt: null,
    gpsLat: null,
    gpsLon: null,
    place: null,
    importedAt: '2026-07-01T00:00:00.000Z',
    importSource: 'story',
    favorite: index % 9 === 0,
    keyId: 1,
    deletedAt: null,
    syncState: 'synced',
  };
}

const PHOTOS = Array.from({ length: 60 }, (_, index) => photo(index));

const onOpen = fn();
const onToggle = fn();

// #76 exit criteria: interaction tests for tile click vs select-circle AT
// THE GRID LEVEL — the events must survive the engine's absolute-positioned
// cell wrapping, not just the bare component (PhotoTile.stories covers that).
export const TileClickVsSelectCircle: Story = {
  render: () => (
    <div style={{ position: 'relative', height: 420 }}>
      <VirtualGrid
        photos={PHOTOS}
        total={PHOTOS.length}
        zoom={140}
        onNeedMore={fn()}
        renderTile={(record) => (
          <PhotoTile
            src={THUMB}
            alt={record.fileName}
            favorite={record.favorite}
            status={record.syncState}
            onClick={() => {
              onOpen(record.id);
            }}
            onToggleSelect={() => {
              onToggle(record.id);
            }}
          />
        )}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tile = await canvas.findByRole('button', { name: 'Open IMG_0.JPG' });
    const circle = within(tile).getByRole('button', { name: 'Select' });
    await userEvent.click(circle);
    await expect(onToggle).toHaveBeenCalledWith('P0');
    await expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(tile);
    await expect(onOpen).toHaveBeenCalledWith('P0');
  },
};

// Windowing sanity in a real browser: far fewer cells mounted than photos.
export const WindowsLargeLibraries: Story = {
  render: () => (
    <div style={{ position: 'relative', height: 420 }}>
      <VirtualGrid photos={PHOTOS} total={100_000} zoom={96} onNeedMore={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByTestId('virtual-grid');
    const cells = canvasElement.querySelectorAll('.ovl-grid__cell');
    await expect(cells.length).toBeGreaterThan(0);
    await expect(cells.length).toBeLessThan(500);
  },
};
