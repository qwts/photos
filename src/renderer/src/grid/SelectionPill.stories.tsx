import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SelectionPill } from './SelectionPill';

const meta: Meta<typeof SelectionPill> = {
  title: 'Grid/SelectionPill',
  component: SelectionPill,
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: 120 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SelectionPill>;

const onClear = fn();

// #78 exit criteria: counts render with thousands separators; Export (#100)
// and Delete (#120) are live, Add to album waits on #118; clear-× works.
export const ThousandsSeparatorAndClear: Story = {
  args: { count: 12_345, onClear, onDelete: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('12,345 SELECTED')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Export/ })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: /Add to album/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: /Delete/ }));
    await expect(args.onDelete).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }));
    await expect(onClear).toHaveBeenCalledTimes(1);
  },
};

export const SingleSelection: Story = {
  args: { count: 1, onClear: fn() },
};

// Trash mode (#120): Restore is the headline; Delete/Export leave until
// #121's purge ceremony.
export const TrashRestoreMode: Story = {
  args: { count: 2, onClear: fn(), onRestore: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /Delete/ })).toBeNull();
    await expect(canvas.queryByRole('button', { name: /Export/ })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: /Restore/ }));
    await expect(args.onRestore).toHaveBeenCalledTimes(1);
  },
};
