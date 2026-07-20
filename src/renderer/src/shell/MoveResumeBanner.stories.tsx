import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { MoveResumeBanner } from './MoveResumeBanner';
import type { OverlookApi } from '../../../shared/ipc/api.js';

const LIBRARY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const resumeMove = fn();
const discardMove = fn();

function installStub(resumable: boolean): void {
  resumeMove.mockReset();
  discardMove.mockReset();
  resumeMove.mockResolvedValue({
    ok: true,
    outcome: 'moved',
    mode: 'copy',
    items: 42,
    bytes: 2048,
    sourcePath: '/Volumes/Old/Overlook',
    destPath: '/Volumes/New/Overlook',
  });
  discardMove.mockResolvedValue({ result: 'discarded' });
  const libraries = {
    pendingMoves: () =>
      Promise.resolve({
        pending: [
          {
            libraryId: LIBRARY_ID,
            state: 'copying' as const,
            sourcePath: '/Volumes/Old/Overlook',
            destPath: '/Volumes/New/Overlook',
            corrupt: false,
            resumable,
          },
        ],
      }),
    resumeMove,
    discardMove,
  } as unknown as OverlookApi['libraries'];
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = { libraries };
}

const meta: Meta<typeof MoveResumeBanner> = {
  title: 'App/MoveResumeBanner',
  component: MoveResumeBanner,
};

export default meta;
type Story = StoryObj<typeof MoveResumeBanner>;

export const ResumeVerifiedStaging: Story = {
  decorators: [
    (Story) => {
      installStub(true);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('/Volumes/Old/Overlook → /Volumes/New/Overlook')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Discard staged copy' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Resume' }));
    await expect(resumeMove).toHaveBeenCalledWith({ id: LIBRARY_ID });
    await waitFor(async () => expect(canvas.queryByTestId('move-resume-banner')).not.toBeInTheDocument());
  },
};

export const DiscardUnverifiableStaging: Story = {
  decorators: [
    (Story) => {
      installStub(false);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/cannot be verified for resume/u)).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Discard staged copy' }));
    await expect(discardMove).toHaveBeenCalledWith({ id: LIBRARY_ID });
  },
};
