import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState, type ReactElement } from 'react';

import { Button } from './Button';
import { useAnnouncer } from './LiveAnnouncer';
import { SelectionAnnouncer } from './SelectionAnnouncer';

function AnnouncerHarness(): ReactElement {
  const { announce } = useAnnouncer();
  const [selectionCount, setSelectionCount] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <SelectionAnnouncer count={selectionCount} />
      <Button onClick={() => announce('Backup complete')}>Announce update</Button>
      <Button onClick={() => announce('Import failed', 'assertive')}>Announce error</Button>
      <Button
        onClick={() => {
          announce('Copying 1 of 4', 'polite', 'import-progress');
          announce('Copying 2 of 4', 'polite', 'import-progress');
        }}
      >
        Coalesce progress
      </Button>
      <Button onClick={() => setSelectionCount((count) => count + 1)}>Select photo</Button>
      <Button onClick={() => setSelectionCount(0)}>Clear selection</Button>
    </div>
  );
}

const meta: Meta<typeof AnnouncerHarness> = {
  title: 'Components/LiveAnnouncer',
  component: AnnouncerHarness,
};

export default meta;
type Story = StoryObj<typeof AnnouncerHarness>;

export const QueuesRepeatedMessagesByPriority: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const polite = canvas.getByTestId('screen-reader-announcer-polite');
    const assertive = canvas.getByTestId('screen-reader-announcer-assertive');
    await expect(polite).toHaveAttribute('aria-live', 'polite');
    await expect(assertive).toHaveAttribute('aria-live', 'assertive');

    await userEvent.click(canvas.getByRole('button', { name: 'Announce update' }));
    await expect(polite).toHaveTextContent('Backup complete');
    const firstMessage = polite.firstElementChild;
    await userEvent.click(canvas.getByRole('button', { name: 'Announce update' }));
    await waitFor(() => expect(polite.firstElementChild).not.toBe(firstMessage), { timeout: 2500 });
    await expect(polite).toHaveTextContent('Backup complete');

    await userEvent.click(canvas.getByRole('button', { name: 'Announce error' }));
    await expect(assertive).toHaveTextContent('Import failed');

    await userEvent.click(canvas.getByRole('button', { name: 'Coalesce progress' }));
    await waitFor(() => expect(polite).toHaveTextContent('Copying 2 of 4'), { timeout: 2500 });
    await expect(polite).not.toHaveTextContent('Copying 1 of 4');

    await userEvent.click(canvas.getByRole('button', { name: 'Select photo' }));
    await waitFor(() => expect(polite).toHaveTextContent('1 photo selected'), { timeout: 2500 });
    await userEvent.click(canvas.getByRole('button', { name: 'Select photo' }));
    await waitFor(() => expect(polite).toHaveTextContent('2 photos selected'), { timeout: 2500 });
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(polite).toHaveTextContent('Selection cleared'), { timeout: 2500 });
  },
};
