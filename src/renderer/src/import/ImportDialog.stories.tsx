import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ImportDialog } from './ImportDialog';

// #88 exit criteria: pixel/copy match to the mock (counts, warnings
// verbatim) + interaction coverage for the Move warning. Phase transitions
// past "options" need the real engine and land with #90's fixture E2E.

const SOURCE = {
  path: '/Volumes/SONY128',
  label: 'SONY 128GB · A7 IV',
  newCount: 1204,
  newBytes: 38_200_000_000,
  newRaw: 812,
  newJpg: 392,
};

const meta: Meta<typeof ImportDialog> = {
  title: 'App/ImportDialog',
  component: ImportDialog,
  args: { open: true, source: SOURCE, onClose: fn(), onDone: fn() },
};

export default meta;
type Story = StoryObj<typeof ImportDialog>;

export const Options: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    // The mock's copy, verbatim: mono card line and exact button count.
    await expect(body.getByText('1,204 NEW · 38.2 GB · 812 RAW / 392 JPG')).toBeVisible();
    await expect(body.getByRole('button', { name: /Import 1,204 photos/u })).toBeVisible();
    await expect(body.getByText('Generate thumbnails on import')).toBeVisible();
    await expect(body.getByText('Encrypt originals (always on)')).toBeVisible();
    // Copy mode shows no warning.
    await expect(body.queryByRole('alert')).toBeNull();
  },
};

export const MoveWarning: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('radio', { name: 'Move' }));
    // README §5 warning, verbatim.
    await expect(body.getByRole('alert')).toHaveTextContent('Originals will be deleted from the card after import.');
    await userEvent.click(body.getByRole('radio', { name: 'Copy' }));
    await expect(body.queryByRole('alert')).toBeNull();
  },
};
