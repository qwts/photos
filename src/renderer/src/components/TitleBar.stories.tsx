import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { TitleBar } from './TitleBar';

const meta: Meta<typeof TitleBar> = {
  title: 'Core/TitleBar',
  component: TitleBar,
};

export default meta;
type Story = StoryObj<typeof TitleBar>;

// mac: only the reserved 78px inset — macOS draws the real traffic lights.
export const Mac: Story = {
  args: { platform: 'darwin' },
};

export const Windows: Story = {
  args: {
    platform: 'win32',
    onMinimize: fn(),
    onToggleMaximize: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Minimize' }));
    await expect(args.onMinimize).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Maximize' }));
    await expect(args.onToggleMaximize).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
