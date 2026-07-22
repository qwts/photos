import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import type { ReactElement } from 'react';

import { Moodboard } from './Moodboard';
import type { Board, Placement } from '../../../shared/moodboard/board.js';
import type { PlacementAvailability } from '../../../shared/moodboard/availability.js';
import type { PlacementView } from './board-seed';

// A tiny inline SVG derivative stands in for the real thumb protocol so the
// canvas renders pixels in Storybook without a running main process.
function swatch(fill: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='4' height='3'><rect width='4' height='3' fill='${fill}'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

interface Demo {
  readonly availability: PlacementAvailability;
  readonly name: string;
  readonly fill: string;
}

const DEMO: Record<string, Demo> = {
  'photo-1': { availability: 'available', name: 'Landscape, Big Sur', fill: '#6b8fb5' },
  'photo-2': { availability: 'available', name: 'Dunes at dawn', fill: '#c7a17a' },
  'photo-3': { availability: 'offloaded', name: 'Tide pools', fill: '#7a9c8a' },
  'photo-4': { availability: 'unavailable', name: '', fill: '#000000' },
  'photo-5': { availability: 'locked', name: '', fill: '#000000' },
  'photo-6': { availability: 'available', name: 'Wildflowers', fill: '#b57a9c' },
  'photo-7': { availability: 'available', name: 'Ridge line', fill: '#7a86b5' },
};

function resolvePlacement(photoId: string): PlacementView {
  const demo = DEMO[photoId] ?? { availability: 'unavailable' as PlacementAvailability, name: '', fill: '#000000' };
  const showPixels = demo.availability === 'available' || demo.availability === 'offloaded';
  return { name: demo.name, thumbSrc: showPixels ? swatch(demo.fill) : null, availability: demo.availability };
}

function place(
  id: string,
  photoId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  groupId: string | null = null,
): Placement {
  return { id, photoId, x, y, w, h, rotation: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, z, groupId };
}

const FULL_BOARD: Board = {
  id: 'story-board',
  title: 'Summer palette',
  notes: 'Warm tones for the coastal set.',
  size: { width: 1600, height: 1200 },
  background: 'ink',
  placements: [
    place('p1', 'photo-1', 120, 100, 260, 190, 1),
    place('p2', 'photo-2', 440, 150, 210, 260, 2),
    place('p3', 'photo-3', 720, 110, 250, 180, 3),
    place('p4', 'photo-4', 320, 440, 220, 160, 4),
    place('p5', 'photo-5', 640, 470, 200, 200, 5),
    place('p6', 'photo-6', 980, 360, 200, 150, 6, 'g1'),
    place('p7', 'photo-7', 1010, 470, 180, 150, 7, 'g1'),
  ],
};

const PLACEHOLDER_BOARD: Board = {
  ...FULL_BOARD,
  placements: [
    place('p3', 'photo-3', 120, 120, 220, 170, 1),
    place('p4', 'photo-4', 400, 120, 200, 160, 2),
    place('p5', 'photo-5', 680, 120, 200, 200, 3),
  ],
};

const EMPTY_BOARD: Board = { ...FULL_BOARD, placements: [] };

function Frame({ children }: { readonly children: ReactElement }): ReactElement {
  return <div style={{ height: 540, display: 'flex' }}>{children}</div>;
}

const meta: Meta<typeof Moodboard> = {
  title: 'App/Moodboard',
  component: Moodboard,
  parameters: { layout: 'fullscreen' },
  args: { resolvePlacement },
  render: (args) => (
    <Frame>
      <Moodboard {...args} />
    </Frame>
  ),
};
export default meta;
type Story = StoryObj<typeof Moodboard>;

export const Canvas: Story = {
  args: { board: FULL_BOARD, initialSelection: ['p1'] },
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    // The parallel reading-order list mirrors the placement set in z order (I5).
    const items = doc.querySelectorAll('.ovl-moodboard__reading-order li');
    await expect(items).toHaveLength(7);
    await expect(items[0]).toHaveTextContent('layer 1 of 7');
    // Focus lands on the first placement, never <body>.
    await waitFor(() => expect(doc.activeElement?.getAttribute('data-testid')).toBe('moodboard-piece-p1'));
  },
};

// Every drag has a keyboard equivalent (I5): an arrow moves the selection and a
// single serialized polite announcement carries the exact string.
export const KeyboardMove: Story = {
  args: { board: FULL_BOARD, initialSelection: ['p1'] },
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const piece = canvasElement.querySelector<HTMLElement>('[data-testid="moodboard-piece-p1"]');
    await waitFor(() => expect(doc.activeElement).toBe(piece));
    await userEvent.keyboard('{ArrowRight}');
    await expect(piece).toHaveStyle({ left: '121px' });
    await expect(doc.querySelector('[data-testid="screen-reader-announcer-polite"]')).toHaveTextContent('Moved to 121, 100.');
  },
};

export const KeyboardRemove: Story = {
  args: { board: FULL_BOARD, initialSelection: ['p1'] },
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    await waitFor(() => expect(doc.activeElement?.getAttribute('data-testid')).toBe('moodboard-piece-p1'));
    await userEvent.keyboard('{Delete}');
    await expect(canvasElement.querySelector('[data-testid="moodboard-piece-p1"]')).toBeNull();
    await expect(doc.querySelector('[data-testid="screen-reader-announcer-polite"]')).toHaveTextContent('Removed from board.');
  },
};

export const Group: Story = { args: { board: FULL_BOARD, initialSelection: ['p6', 'p7'] } };

export const Layering: Story = {
  args: {
    board: {
      ...FULL_BOARD,
      placements: [
        place('p1', 'photo-1', 200, 160, 280, 210, 1),
        place('p2', 'photo-2', 320, 240, 260, 200, 2),
        place('p3', 'photo-3', 440, 320, 240, 190, 3),
      ],
    },
    initialSelection: ['p3'],
  },
};

export const Placeholders: Story = { args: { board: PLACEHOLDER_BOARD } };

export const Panel: Story = { args: { board: FULL_BOARD, initialSelection: ['p2'] } };

export const Empty: Story = { args: { board: EMPTY_BOARD } };

export const Light: Story = { args: { board: FULL_BOARD, initialSelection: ['p1'] }, globals: { theme: 'light' } };

export const RTL: Story = {
  args: { board: FULL_BOARD },
  decorators: [
    (StoryFn): ReactElement => (
      <div dir="rtl">
        <StoryFn />
      </div>
    ),
  ],
};

export const ReducedMotion: Story = {
  args: { board: FULL_BOARD, initialSelection: ['p1'] },
  parameters: { chromatic: { prefersReducedMotion: 'reduce' } },
};
