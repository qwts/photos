import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

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
      <Toast tone="amber" title="Encrypting 42 → Google Drive" />
      <Toast
        tone="red"
        title="Backup failed"
        detail="Cloud provider unreachable"
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
    const announcer = canvas.getByRole('status');
    await expect(announcer).toHaveTextContent('Backup verified');
    await waitFor(
      async () => {
        await expect(canvasElement.querySelector('.ovl-toast')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    await expect(announcer).toBeInTheDocument();
    await expect(announcer).toBeEmptyDOMElement();
  },
};

function ActionToastDemo(): ReactElement {
  const [visible, setVisible] = useState(true);
  const toasts: readonly ToastItem[] = visible
    ? [
        {
          id: 'action',
          tone: 'red',
          title: 'Backup failed',
          action: (
            <Button variant="ghost" size="sm" onClick={() => setVisible(false)}>
              Retry
            </Button>
          ),
        },
      ]
    : [];
  return <ToastHost toasts={toasts} autoDismissMs={200} onDismiss={() => setVisible(false)} />;
}

export const ActionStaysUntilUsed: Story = {
  render: () => <ActionToastDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(canvasElement.querySelector('.ovl-toast')).not.toBeInTheDocument();
  },
};

function PausableToastDemo(): ReactElement {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([{ id: 'pause', title: 'Import complete' }]);
  return <ToastHost toasts={toasts} autoDismissMs={400} onDismiss={() => setToasts([])} />;
}

export const HoverPausesDismissal: Story = {
  render: () => <PausableToastDemo />,
  play: async ({ canvasElement }) => {
    const toast = canvasElement.querySelector('.ovl-toast');
    await expect(toast).toBeInTheDocument();
    if (toast === null) return;
    await userEvent.hover(toast);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await expect(toast).toBeInTheDocument();
    await userEvent.unhover(toast);
    await waitFor(async () => expect(toast).not.toBeInTheDocument(), { timeout: 2000 });
  },
};

export const FocusPausesDismissal: Story = {
  render: () => <PausableToastDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dismiss = canvas.getByRole('button', { name: 'Dismiss notification' });
    dismiss.focus();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await expect(dismiss).toBeInTheDocument();
    dismiss.blur();
    await waitFor(async () => expect(dismiss).not.toBeInTheDocument(), { timeout: 2000 });
  },
};
