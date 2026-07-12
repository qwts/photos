import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Button } from './Button';
import { Tooltip } from './Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Core/Tooltip',
  component: Tooltip,
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const AppearsOnHover: Story = {
  render: () => (
    <div style={{ padding: 'var(--space-9) var(--space-7)' }}>
      <Tooltip label="All photos backed up">
        <Button variant="secondary">Hover me</Button>
      </Tooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(canvas.getByRole('button'));
    await waitFor(async () => {
      await expect(canvas.getByRole('tooltip')).toHaveTextContent('All photos backed up');
    });
    await userEvent.unhover(canvas.getByRole('button'));
    await waitFor(async () => {
      await expect(canvas.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  },
};

export const BottomSide: Story = {
  render: () => (
    <div style={{ padding: 'var(--space-7)' }}>
      <Tooltip label="Back up now" side="bottom">
        <Button variant="secondary">Bottom</Button>
      </Tooltip>
    </div>
  ),
};
