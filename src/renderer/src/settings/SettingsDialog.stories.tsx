import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SettingsDialog } from './SettingsDialog';

// #112 exit criteria: the 640px two-pane frame — Storage & Backup opens by
// default per the design, nav rows switch panes and are keyboard-operable,
// Esc closes. Section internals land with #113–#115.

const meta: Meta<typeof SettingsDialog> = {
  title: 'App/SettingsDialog',
  component: SettingsDialog,
  args: { open: true, onClose: fn() },
};

export default meta;
type Story = StoryObj<typeof SettingsDialog>;

export const StorageOpensByDefault: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    const storage = body.getByRole('button', { name: 'Storage & Backup' });
    await expect(storage).toHaveAttribute('aria-current', 'true');
    await expect(body.getByText('Storage & Backup settings land here next.')).toBeVisible();
  },
};

export const NavSwitchesPanes: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'General' }));
    await expect(body.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true');
    await expect(body.getByText('General settings land here next.')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Privacy' }));
    await expect(body.getByText('Privacy settings land here next.')).toBeVisible();
  },
};

export const KeyboardOperable: Story = {
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    // The nav rows are real buttons: Tab reaches them (after the header's
    // Close control), Enter activates.
    await userEvent.tab();
    await userEvent.tab();
    await expect(body.getByRole('button', { name: 'General' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(body.getByText('General settings land here next.')).toBeVisible();
    // Esc closes from anywhere inside the dialog.
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
