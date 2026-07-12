import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { expect, waitFor, within } from 'storybook/test';

import { Button } from './Button';
import { Toast, ToastHost, type ToastItem } from './Toast';

const meta: Meta<typeof Toast> = {
  title: 'Overlays/Toast',
  component: Toast,
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Tones: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-7)', justifyItems: 'start' }}>
      <Toast title="Import complete" detail="1,204 photos added" />
      <Toast tone="green" title="Backup verified" detail="All photos backed up" />
      <Toast tone="amber" title="Encrypting 42 → pCloud" />
      <Toast
        tone="red"
        title="Backup failed"
        detail="pCloud unreachable"
        action={
          <Button variant="ghost" size="sm">
            Retry
          </Button>
        }
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const statuses = within(canvasElement).getAllByRole('status');
    await expect(statuses).toHaveLength(4);
  },
};

function AutoDismissDemo(): ReactElement {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([{ id: 't1', tone: 'green', title: 'Backup verified' }]);
  return (
    <div style={{ position: 'relative', height: 200 }}>
      <ToastHost
        toasts={toasts}
        autoDismissMs={400}
        onDismiss={(id) => {
          setToasts((current) => current.filter((toast) => toast.id !== id));
        }}
      />
    </div>
  );
}

export const AutoDismiss: Story = {
  render: () => <AutoDismissDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toBeInTheDocument();
    await waitFor(
      async () => {
        await expect(canvas.queryByRole('status')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  },
};
