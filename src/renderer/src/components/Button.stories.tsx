import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button, type ButtonVariant, type ControlSize } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Core/Button',
  component: Button,
};

export default meta;
type Story = StoryObj<typeof Button>;

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const SIZES: readonly ControlSize[] = ['sm', 'md', 'lg'];

function Matrix(): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)', padding: 'var(--space-7)' }}>
      {VARIANTS.map((variant) => (
        <div key={variant} style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              {variant === 'danger' ? 'Delete 12 photos' : 'Import 1,204 photos'}
            </Button>
          ))}
          <Button variant={variant} icon="download">
            With icon
          </Button>
          <Button variant={variant} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  );
}

export const AllVariants: Story = {
  render: () => <Matrix />,
};

export const ClickFires: Story = {
  args: {
    variant: 'primary',
    children: 'Import 1,204 photos',
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button'));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const DisabledDoesNotFire: Story = {
  args: {
    variant: 'primary',
    children: 'Import 1,204 photos',
    disabled: true,
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');
    await expect(button).toBeDisabled();
    // pointer-events: none makes a real click impossible; dispatch directly to
    // prove the disabled attribute itself blocks activation too.
    button.click();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const DangerHoverContrast: Story = {
  args: {
    variant: 'danger',
    children: 'Delete 12 photos',
  },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button'));
  },
};

export const DangerActiveContrast: Story = {
  args: {
    variant: 'danger',
    children: 'Delete 12 photos',
  },
  play: async ({ canvasElement }) => {
    await userEvent.pointer({ keys: '[MouseLeft>]', target: within(canvasElement).getByRole('button') });
  },
};
