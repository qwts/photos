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

// #78 exit criteria: counts render with thousands separators; the bulk
// actions are visible-but-disabled entry points; clear-× works.
export const ThousandsSeparatorAndClear: Story = {
  args: { count: 12_345, onClear },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('12,345 SELECTED')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Export/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /Add to album/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /Delete/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }));
    await expect(onClear).toHaveBeenCalledTimes(1);
  },
};

export const SingleSelection: Story = {
  args: { count: 1, onClear: fn() },
};
