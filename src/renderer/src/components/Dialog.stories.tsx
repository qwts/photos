import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Button } from './Button';
import { Dialog } from './Dialog';

const meta: Meta<typeof Dialog> = {
  title: 'Overlays/Dialog',
  component: Dialog,
};

export default meta;
type Story = StoryObj<typeof Dialog>;

function ImportShell({ onClose }: { readonly onClose?: (() => void) | undefined }): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ position: 'relative', height: 480 }}>
      <Dialog
        open={open}
        title="Import photos"
        icon="download"
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        footer={
          <>
            <Button variant="ghost">Cancel</Button>
            <Button variant="primary">Import 1,204 photos</Button>
          </>
        }
      >
        Originals stay on disk, encrypted with your key.
      </Dialog>
    </div>
  );
}

export const FlowDialog: Story = {
  render: () => <ImportShell />,
};

export const BackdropAndInnerClicks: Story = {
  args: { onClose: fn() },
  render: (args) => <ImportShell onClose={args.onClose} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Inner click: dialog stays.
    await userEvent.click(canvas.getByRole('dialog'));
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(canvas.getByRole('dialog')).toBeInTheDocument();
    // Backdrop click closes.
    const scrim = canvasElement.querySelector('.ovl-dialog-scrim');
    if (scrim === null) throw new Error('scrim missing');
    await userEvent.click(scrim);
    await waitFor(async () => {
      await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const EscapeCloses: Story = {
  args: { onClose: fn() },
  render: (args) => <ImportShell onClose={args.onClose} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const FocusStaysTrapped: Story = {
  render: () => <ImportShell />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Tab far past the focusable count — focus must always stay inside.
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      await expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    await expect(dialog.contains(document.activeElement)).toBe(true);
  },
};
