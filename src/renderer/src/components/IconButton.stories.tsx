import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';

import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';

const meta: Meta<typeof IconButton> = {
  title: 'Core/IconButton',
  component: IconButton,
};

export default meta;
type Story = StoryObj<typeof IconButton>;

function Row(): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', padding: 'var(--space-7)' }}>
      <IconButton icon="funnel" label="Filter" size="sm" />
      <IconButton icon="funnel" label="Filter" size="md" />
      <IconButton icon="funnel" label="Filter" size="lg" />
      <IconButton icon="info" label="Inspector" active />
      <IconButton icon="refresh-cw" label="Sync" disabled />
      <Tooltip label="Back up now">
        <IconButton icon="cloud-upload" label="Back up" />
      </Tooltip>
    </div>
  );
}

export const AllStates: Story = {
  render: () => <Row />,
};
