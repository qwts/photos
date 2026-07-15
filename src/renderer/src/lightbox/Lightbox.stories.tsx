import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Lightbox } from './Lightbox';
import type { PhotoRecord } from '../../../shared/library/types.js';

// #92 exit criteria: chrome hides after 2.2s idle and wakes on mousemove
// (200ms ease-out fades); RAW records carry the PREVIEW badge; the EXIF
// strip renders only what the file states.

const PHOTO: PhotoRecord = {
  id: '01J8SEEDPHOTO0001',
  fileName: 'IMG_4028.JPG',
  fileKind: 'jpeg',
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
  importedAt: '2026-07-01T00:00:00.000Z',
  importSource: 'seed',
  favorite: false,
  keyId: 1,
  deletedAt: null,
  syncState: 'local',
};

const meta: Meta<typeof Lightbox> = {
  title: 'App/Lightbox',
  component: Lightbox,
  args: {
    photo: PHOTO,
    onClose: fn(),
    onPrev: fn(),
    onNext: fn(),
    onToggleFavorite: fn(),
    inspectorOpen: false,
    onToggleInspector: fn(),
    onExport: fn(),
    onOffload: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Lightbox>;

export const ChromeAutohide: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const surface = canvas.getByTestId('lightbox');
    // Chrome starts awake with the full control set and the EXIF strip.
    await expect(surface).toHaveAttribute('data-chrome', 'on');
    await expect(canvas.getByText('FUJIFILM X-T5 · ƒ/1.4 · 1/250S · ISO 200 · 35MM')).toBeVisible();
    // ...hides after the 2.2s idle window...
    await waitFor(() => expect(surface).toHaveAttribute('data-chrome', 'off'), { timeout: 4000 });
    // ...and wakes on mousemove.
    await userEvent.pointer({ target: surface, coords: { x: 200, y: 200 } });
    await expect(surface).toHaveAttribute('data-chrome', 'on');
  },
};

// #269: an explicit ✕ closes back to the gallery — the back arrow reads as
// navigation and Esc is invisible; both still work alongside it.
export const CloseButton: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Close (Esc)' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const RawPreviewBadge: Story = {
  args: { photo: { ...PHOTO, fileKind: 'raw', fileName: 'IMG_4021.RAF' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('PREVIEW')).toBeVisible();
    await expect(canvas.getByText(/IMG_4021\.RAF — 2026-06-12/u)).toBeVisible();
  },
};

export const SyncedOriginalCanBeOffloaded: Story = {
  args: { photo: { ...PHOTO, syncState: 'synced' } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Offload original' }));
    await expect(args.onOffload).toHaveBeenCalledTimes(1);
  },
};
