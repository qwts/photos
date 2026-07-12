import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';

import { Badge, type BadgeTone } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Core/Badge',
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

const TONES: readonly BadgeTone[] = ['neutral', 'cyan', 'amber', 'green', 'red'];

function Tones(): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', padding: 'var(--space-7)' }}>
      {TONES.map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
      <Badge tone="green" icon="shield-check">
        Encrypted
      </Badge>
      <Badge tone="amber" icon="cloud">
        Offloaded
      </Badge>
    </div>
  );
}

export const AllTones: Story = {
  render: () => <Tones />,
};
