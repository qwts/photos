import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Inspector } from './Inspector';
import type { PhotoRecord } from '../../../shared/library/types.js';

// #94 exit criteria: §4 visual match — grouped truth rows, interpunct mono
// values, RAF → RAW badge, missing EXIF rows OMITTED (never fabricated).

const PHOTO: PhotoRecord = {
  id: '01J8SEEDPHOTO0000',
  fileName: 'IMG_4021.RAF',
  fileKind: 'raw',
  width: 6240,
  height: 4160,
  bytes: 8_400_000,
  contentHash: 'a'.repeat(64),
  camera: 'FUJIFILM X-T5',
  lens: 'XF 35MM F/1.4',
  iso: 200,
  aperture: '1.4',
  shutter: '1/250',
  focalLength: 35,
  takenAt: '2026-06-12T12:34:56',
  gpsLat: null,
  gpsLon: null,
  place: 'Lisbon',
  importedAt: '2026-07-02T00:00:00.000Z',
  importSource: 'SD card',
  favorite: true,
  keyId: 2,
  deletedAt: null,
  previewFailure: null,
  syncState: 'synced',
};

const meta: Meta<typeof Inspector> = {
  title: 'App/Inspector',
  component: Inspector,
  decorators: [
    (Story) => (
      <div style={{ width: 'var(--inspector-w)', height: 480, background: 'var(--gray-1)', borderLeft: '1px solid var(--border-1)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Inspector>;

export const RafFavorite: Story = {
  args: { photo: PHOTO, providerLabel: 'Local mock' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('RAW')).toBeVisible();
    await expect(canvas.getByText('Encrypted')).toBeVisible();
    await expect(canvas.getByText('Favorite')).toBeVisible();
    await expect(canvas.getByText('2026-06-12 · LISBON')).toBeVisible();
    // Interpunct-joined mono values per the copy rules.
    await expect(canvas.getByText('ƒ/1.4 · 1/250S · ISO 200')).toBeVisible();
    await expect(canvas.getByText('6240×4160 · 26.0 MP')).toBeVisible();
    await expect(canvas.getByText('2026-07-02 · SD CARD')).toBeVisible();
    // Real key metadata + the honest synced copy (no fabricated timestamp).
    await expect(canvas.getByText('AES-256-GCM · KEY #2')).toBeVisible();
    await expect(canvas.getByText('ENCRYPTED · LOCAL MOCK')).toBeVisible();
  },
};

export const MetadataLite: Story = {
  args: {
    photo: {
      ...PHOTO,
      fileKind: 'jpeg',
      fileName: 'scan-0001.jpg',
      camera: null,
      lens: null,
      iso: null,
      aperture: null,
      shutter: null,
      focalLength: null,
      takenAt: null,
      place: null,
      favorite: false,
      syncState: 'local',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Missing EXIF rows are OMITTED — never fabricated.
    await expect(canvas.queryByText('Camera')).toBeNull();
    await expect(canvas.queryByText('Exposure')).toBeNull();
    await expect(canvas.queryByText('Favorite')).toBeNull();
    await expect(canvas.getByText('JPEG')).toBeVisible();
    await expect(canvas.getByText('LOCAL ONLY — NOT BACKED UP')).toBeVisible();
  },
};

export const UnknownDimensions: Story = {
  args: { photo: { ...PHOTO, width: 0, height: 0, fileName: 'legacy-zero.jpg' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Unknown — repair pending')).toBeVisible();
    await expect(canvas.queryByText('0×0 · 0.0 MP')).toBeNull();
  },
};

export const Empty: Story = {
  args: { photo: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Select a photo')).toBeVisible();
  },
};
