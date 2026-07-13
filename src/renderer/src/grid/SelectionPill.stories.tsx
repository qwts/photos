import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SelectionPill } from './SelectionPill';
import type { AlbumSummary } from '../../../shared/library/types.js';

// The picker (#118) reads albums over the bridge — a two-album stub with a
// working inline create. Only the two calls the picker makes are stubbed,
// so the global slot is typed unknown rather than faking a full OverlookApi.
function installStub(): void {
  const albums: AlbumSummary[] = [
    { id: 'A1', name: 'Big Sur', count: 10 },
    { id: 'A2', name: 'Kyoto', count: 4 },
  ];
  (globalThis as { overlook?: unknown }).overlook = {
    library: { albums: () => Promise.resolve({ albums }) },
    albums: {
      create: ({ name }: { name: string }) => {
        const album = { id: `A${String(albums.length + 1)}`, name, count: 0 };
        albums.push(album);
        return Promise.resolve({ album });
      },
    },
  };
}

const meta: Meta<typeof SelectionPill> = {
  title: 'Grid/SelectionPill',
  component: SelectionPill,
  decorators: [
    (Story) => {
      installStub();
      return (
        <div style={{ position: 'relative', height: 320, display: 'flex', alignItems: 'flex-end' }}>
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof SelectionPill>;

const onClear = fn();

// #78 exit criteria: counts render with thousands separators; Export (#100),
// Delete (#120), and Add to album (#118) are live; clear-× works.
export const ThousandsSeparatorAndClear: Story = {
  args: { count: 12_345, onClear, onDelete: fn(), onAddToAlbum: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('12,345 SELECTED')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Export/ })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: /Add to album/ })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: /Delete/ }));
    await expect(args.onDelete).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }));
    await expect(onClear).toHaveBeenCalledTimes(1);
  },
};

export const SingleSelection: Story = {
  args: { count: 1, onClear: fn() },
};

// Trash mode (#120/#121): Restore is the headline; the red Delete opens
// the purge ceremony; Export leaves.
export const TrashRestoreMode: Story = {
  args: { count: 2, onClear: fn(), onRestore: fn(), onPurge: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /Export/ })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: /Restore/ }));
    await expect(args.onRestore).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: /Delete/ }));
    await expect(args.onPurge).toHaveBeenCalledTimes(1);
  },
};

// Add-to-album picker (#118): albums with live counts, pick fires with the
// album, Escape closes, inline create picks the new album.
export const AlbumPickerFlow: Story = {
  args: { count: 12, onClear: fn(), onDelete: fn(), onAddToAlbum: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Add to album/ }));
    // Focus moves INTO the picker on open (PR #219 review) — keyboard users
    // land on the first album row, not back on the trigger.
    await waitFor(() => expect(canvas.getByRole('menuitem', { name: /Big Sur/ })).toHaveFocus());
    await userEvent.click(canvas.getByRole('menuitem', { name: /Big Sur/ }));
    await expect(args.onAddToAlbum).toHaveBeenCalledWith({ id: 'A1', name: 'Big Sur', count: 10 });
    await expect(canvas.queryByTestId('album-picker')).toBeNull();

    // Inline create picks the fresh album.
    await userEvent.click(canvas.getByRole('button', { name: /Add to album/ }));
    await userEvent.type(await canvas.findByLabelText('New album name'), 'Yosemite{Enter}');
    await waitFor(() => expect(args.onAddToAlbum).toHaveBeenCalledWith({ id: 'A3', name: 'Yosemite', count: 0 }));

    // Escape closes without picking.
    await userEvent.click(canvas.getByRole('button', { name: /Add to album/ }));
    await waitFor(() => expect(canvas.getByTestId('album-picker')).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await expect(canvas.queryByTestId('album-picker')).toBeNull();
  },
};
