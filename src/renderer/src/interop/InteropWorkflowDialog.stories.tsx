import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { InteropWorkflowDialog } from './InteropWorkflowDialog';
import { blockedInteropWorkflow, type InteropVisibleWorkflow } from './visible-workflow.js';

const onClose = fn();
const onPause = fn();
const onResume = fn();
const onReconnect = fn();
const onConflict = fn();

const meta: Meta<typeof InteropWorkflowDialog> = {
  title: 'Interop/Transfer and Sync',
  component: InteropWorkflowDialog,
  args: { state: reviewState(), onClose, onPause, onResume, onCancel: fn(), onStart: fn(), onReconnect, onConflict },
};

export default meta;
type Story = StoryObj<typeof InteropWorkflowDialog>;

export const Review: Story = {};
export const ProviderDisconnected: Story = { args: { state: blockedInteropWorkflow('settings', 0) } };
export const ConflictReview: Story = {
  args: {
    state: {
      ...reviewState(),
      conflicts: [{ interopId: 'interop-conflict-1', label: 'alpine-lake.raw', fields: ['title', 'albums'] }],
    },
  },
  play: async ({ args, canvasElement }) => {
    onConflict.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('Apply to all conflicts'));
    await userEvent.click(canvas.getByRole('button', { name: 'Keep both' }));
    await expect(args.onConflict).toHaveBeenCalledWith('interop-conflict-1', 'keep-both', true);
  },
};
export const Transferring: Story = {
  args: { state: progressState('transferring') },
  play: async ({ args, canvasElement }) => {
    onPause.mockClear();
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Start move' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Pause' }));
    await expect(args.onPause).toHaveBeenCalledTimes(1);
  },
};
export const Paused: Story = { args: { state: progressState('paused') } };
export const AwaitingAcknowledgement: Story = { args: { state: progressState('awaiting-acknowledgement') } };
export const PartialFailure: Story = {
  args: {
    state: {
      ...progressState('failed'),
      error: { code: 'partial-failure', message: '7 completed; 1 remains resumable.', retryable: true },
    },
  },
  play: async ({ args, canvasElement }) => {
    onResume.mockClear();
    onReconnect.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole('alert')).getByRole('button', { name: 'Resume' }));
    await expect(args.onResume).toHaveBeenCalledTimes(1);
    await expect(args.onReconnect).not.toHaveBeenCalled();
  },
};
export const AuthenticationExpired: Story = {
  args: {
    state: {
      ...progressState('failed'),
      error: { code: 'auth-expired', message: 'Provider authorization expired.', retryable: true },
    },
  },
  play: async ({ args, canvasElement }) => {
    onResume.mockClear();
    onReconnect.mockClear();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Reconnect' }));
    await expect(args.onReconnect).toHaveBeenCalledTimes(1);
    await expect(args.onResume).not.toHaveBeenCalled();
  },
};
export const Completed: Story = { args: { state: progressState('completed') } };
export const Narrow: Story = {
  args: { state: reviewState() },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

function reviewState(): InteropVisibleWorkflow {
  return {
    ...blockedInteropWorkflow('selection', 12),
    provider: { id: 'google-drive', label: 'Google Drive', state: 'connected', detail: 'Encrypted interop namespace · quota verified' },
    pairing: 'paired',
    phase: 'reviewing',
    counts: {
      total: 12,
      eligible: 7,
      duplicate: 1,
      conflict: 1,
      metadataOnly: 1,
      unsupported: 1,
      skipped: 1,
      failed: 0,
      acknowledged: 0,
      finalized: 0,
    },
    error: null,
  };
}

function progressState(phase: InteropVisibleWorkflow['phase']): InteropVisibleWorkflow {
  return {
    ...reviewState(),
    phase,
    processed: phase === 'completed' ? 12 : 7,
    counts: { ...reviewState().counts, acknowledged: phase === 'completed' ? 12 : 7, finalized: phase === 'completed' ? 12 : 6 },
  };
}
