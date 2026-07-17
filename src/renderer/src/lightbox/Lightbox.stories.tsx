import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';

import landscapePhoto from '../../../../tests/fixtures/photos/summer-landscape.jpg';
import portraitPhoto from '../../../../tests/fixtures/photos/street-city.jpg';
import { Lightbox, type LightboxProps } from './Lightbox';
import type { PhotoRecord } from '../../../shared/library/types.js';
import type { OverlookApi } from '../../../shared/ipc/api.js';

// #92 exit criteria: chrome hides after 2.2s idle and wakes on mousemove
// (200ms ease-out fades); RAW records carry the PREVIEW badge; the EXIF
// strip renders only what the file states.

const PHOTO: PhotoRecord = {
  id: '01J8SEEDPHOTO0001',
  fileName: 'IMG_4028.JPG',
  fileKind: 'jpeg',
  width: 1280,
  height: 838,
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

type EphemeralStage = 'fetching' | 'verifying' | 'ready' | 'released' | 'error';

let backupStubCalls = { status: 0, prepare: 0 };

function installBackupStub(stage: EphemeralStage | null): void {
  backupStubCalls = { status: 0, prepare: 0 };
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = {
    backup: {
      ephemeralStatus: () => {
        backupStubCalls.status += 1;
        return Promise.resolve({ stage });
      },
      prepareEphemeral: () => {
        backupStubCalls.prepare += 1;
        return Promise.resolve({ custody: 'ephemeral' });
      },
      releaseEphemeral: () => Promise.resolve({ ok: true }),
      keepDownloaded: () => Promise.resolve({ ok: true }),
      onEphemeralState: () => () => undefined,
    } as unknown as OverlookApi['backup'],
  };
}

const meta: Meta<typeof Lightbox> = {
  title: 'App/Lightbox',
  component: Lightbox,
  args: {
    photo: PHOTO,
    imageSrc: landscapePhoto,
    onClose: fn(),
    onPrev: fn(),
    onNext: fn(),
    onToggleFavorite: fn(),
    inspectorOpen: false,
    onToggleInspector: fn(),
    onExport: fn(),
    onOffload: fn(),
    onRepairDimensions: fn(),
    onDelete: fn(),
  },
  decorators: [
    (Story, context) => {
      installBackupStub((context.parameters['ephemeralStage'] as EphemeralStage | null | undefined) ?? null);
      const width = (context.parameters['lightboxWidth'] as number | undefined) ?? 960;
      const height = (context.parameters['lightboxHeight'] as number | undefined) ?? 640;
      return (
        <div style={{ position: 'relative', width: `min(${String(width)}px, 100vw)`, height: `${String(height)}px`, overflow: 'hidden' }}>
          <Story />
        </div>
      );
    },
  ],
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

export const PortraitFillZoomAndReset: Story = {
  args: {
    photo: { ...PHOTO, width: 960, height: 1280, fileName: 'PORTRAIT.JPG' },
    imageSrc: portraitPhoto,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const image = canvas.getByRole('img', { name: 'PORTRAIT.JPG' });
    const viewport = canvas.getByTestId('lightbox-viewport');
    await waitFor(() => expect(image).toHaveProperty('naturalWidth', 960));
    await expect(viewport).toHaveAttribute('data-mode', 'fit');
    await expect(viewport).toHaveAttribute('data-zoom', '1.000');
    await userEvent.dblClick(image);
    await expect(viewport).toHaveAttribute('data-mode', 'fill');
    await expect(viewport).toHaveAttribute('data-zoom', '2.000');
    await userEvent.click(canvas.getByRole('button', { name: 'Fit image (0)' }));
    await expect(viewport).toHaveAttribute('data-mode', 'fit');
    await expect(viewport).toHaveAttribute('data-zoom', '1.000');
  },
};

export const LandscapeFillCoversWidescreenAndPans: Story = {
  parameters: { lightboxHeight: 540 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const image = canvas.getByRole('img', { name: 'IMG_4028.JPG' });
    const viewport = canvas.getByTestId('lightbox-viewport');
    await waitFor(() => expect(image).toHaveProperty('naturalWidth', 1280));
    await userEvent.dblClick(image);
    await expect(viewport).toHaveAttribute('data-mode', 'fill');
    await waitFor(async () => {
      const viewportBounds = viewport.getBoundingClientRect();
      const imageBounds = image.getBoundingClientRect();
      await expect(imageBounds.width).toBeGreaterThanOrEqual(viewportBounds.width - 1);
      await expect(imageBounds.height).toBeGreaterThanOrEqual(viewportBounds.height - 1);
    });
    await fireEvent.wheel(image, { deltaY: 5000 });
    await waitFor(() => expect(Number(viewport.dataset['panY'])).toBeLessThan(0));
    await fireEvent.wheel(image, { deltaY: -10000 });
    await waitFor(() => expect(Number(viewport.dataset['panY'])).toBeGreaterThan(0));
  },
};

export const LegacyUnknownDimensionsRepairOnDecode: Story = {
  args: {
    photo: { ...PHOTO, width: 0, height: 0, fileName: 'LEGACY-ZERO.JPG' },
    imageSrc: portraitPhoto,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvas.getByTestId('lightbox-viewport');
    await waitFor(() => expect(viewport).toHaveAttribute('data-image-width', '960'));
    await expect(viewport).toHaveAttribute('data-image-height', '1280');
    await expect(canvas.getByRole('img', { name: 'LEGACY-ZERO.JPG' })).toBeVisible();
    await expect(args.onRepairDimensions).toHaveBeenCalledWith(960, 1280);
  },
};

export const UndecodablePreviewIsExplicit: Story = {
  args: {
    photo: { ...PHOTO, width: 0, height: 0, fileName: 'CORRUPT.JPG' },
    imageSrc: 'data:image/jpeg;base64,AAAA',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText('PREVIEW UNAVAILABLE')).toBeVisible());
    await expect(canvas.getByTestId('lightbox-viewport')).toHaveAttribute('data-unavailable', 'true');
  },
};

export const KeyboardZoom: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvas.getByTestId('lightbox-viewport');
    await userEvent.keyboard('+');
    await expect(viewport).toHaveAttribute('data-mode', 'custom');
    await expect(canvas.getByRole('button', { name: 'Fit image (0)' })).toHaveTextContent('125%');
    await userEvent.keyboard('0');
    await expect(canvas.getByRole('button', { name: 'Fit image (0)' })).toHaveTextContent('100%');
  },
};

export const OrientationToolbar: Story = {
  args: {
    photo: { ...PHOTO, width: 960, height: 1280, fileName: 'PORTRAIT.JPG' },
    imageSrc: portraitPhoto,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvas.getByTestId('lightbox-viewport');
    const image = canvas.getByRole('img', { name: 'PORTRAIT.JPG' });
    const resetOrientation = canvas.getByRole('button', { name: 'Reset orientation (R)' });
    await waitFor(() => expect(image).toHaveProperty('naturalWidth', 960));
    await expect(resetOrientation).toBeDisabled();

    await userEvent.click(canvas.getByRole('button', { name: 'Zoom in (+)' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Rotate right (])' }));
    await expect(viewport).toHaveAttribute('data-orientation-turns', '1');
    await expect(image.style.transform).toContain('rotate(90deg)');
    await userEvent.click(canvas.getByRole('button', { name: 'Flip horizontal (Backslash)' }));
    await expect(viewport).toHaveAttribute('data-orientation-flipped', 'true');
    await userEvent.click(resetOrientation);
    await expect(viewport).toHaveAttribute('data-orientation-turns', '0');
    await expect(viewport).toHaveAttribute('data-orientation-flipped', 'false');
    await expect(viewport).toHaveAttribute('data-zoom', '1.250');

    await userEvent.keyboard(']');
    await userEvent.keyboard('\\');
    await expect(viewport).toHaveAttribute('data-orientation-turns', '1');
    await expect(viewport).toHaveAttribute('data-orientation-flipped', 'true');
    await userEvent.keyboard('r');
    await expect(viewport).toHaveAttribute('data-orientation-turns', '0');
    await expect(viewport).toHaveAttribute('data-orientation-flipped', 'false');
  },
};

export const NarrowOrientationToolbar: Story = {
  ...OrientationToolbar,
  parameters: { lightboxWidth: 600 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const orientation = canvas.getByRole('toolbar', { name: 'Image orientation controls' });
    const zoom = canvas.getByLabelText('Image zoom controls');
    await expect(orientation).toBeVisible();
    await expect(zoom).toBeVisible();
    await waitFor(() => expect(zoom.getBoundingClientRect().bottom).toBeLessThanOrEqual(orientation.getBoundingClientRect().top));
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

export const OffloadedFetching: Story = {
  args: { photo: { ...PHOTO, syncState: 'offloaded' } },
  parameters: { ephemeralStage: 'fetching' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText('FETCHING ORIGINAL…')).toBeVisible());
    await expect(canvas.queryByRole('button', { name: 'Keep downloaded' })).not.toBeInTheDocument();
  },
};

export const OffloadedVerifying: Story = {
  args: { photo: { ...PHOTO, syncState: 'offloaded' } },
  parameters: { ephemeralStage: 'verifying' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByText('VERIFYING ORIGINAL…')).toBeVisible());
  },
};

export const OffloadedStreaming: Story = {
  args: { photo: { ...PHOTO, syncState: 'offloaded' } },
  parameters: { ephemeralStage: 'ready' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText('STREAMING ORIGINAL · RE-OFFLOADS ON CLOSE')).toBeVisible());
    await expect(canvas.getByRole('button', { name: 'Keep downloaded' })).toBeVisible();
    await expect(canvas.getByText('FUJIFILM X-T5 · ƒ/1.4 · 1/250S · ISO 200 · 35MM')).toBeVisible();
  },
};

export const OffloadedUnavailable: Story = {
  args: { photo: { ...PHOTO, syncState: 'offloaded' } },
  parameters: { ephemeralStage: 'error' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByText('ORIGINAL UNAVAILABLE')).toBeVisible());
  },
};

function OffloadTransitionHarness(args: LightboxProps) {
  const [offloading, setOffloading] = useState(false);
  return (
    <Lightbox
      {...args}
      photo={{ ...args.photo, syncState: offloading ? 'offloaded' : 'synced' }}
      suppressRehydrate={offloading}
      onOffload={() => setOffloading(true)}
    />
  );
}

export const OffloadSuppressionBlocksFetch: Story = {
  args: { photo: { ...PHOTO, syncState: 'synced' } },
  render: (args) => <OffloadTransitionHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const originalImage = canvas.getByRole('img', { name: PHOTO.fileName });
    await userEvent.click(canvas.getByRole('button', { name: 'Offload original' }));
    await waitFor(() => expect(backupStubCalls.status).toBeGreaterThan(0));
    await expect(backupStubCalls.prepare).toBe(0);
    await expect(canvas.getByRole('img', { name: PHOTO.fileName })).toBe(originalImage);
  },
};
