import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { MetadataRow } from './MetadataRow';
import { ProgressBar } from './ProgressBar';
import { StatusGlyph, SYNC_STATES, type SyncState } from './StatusGlyph';

const meta: Meta = {
  title: 'Feedback/Primitives',
};

export default meta;

export const Progress: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-6)', padding: 'var(--space-7)', maxWidth: 360 }}>
      <ProgressBar label="Copying & encrypting" detail="842 / 1,204" value={842} max={1204} />
      <ProgressBar label="Generating thumbnails" detail="120 / 1,204" value={120} max={1204} tone="amber" />
      <ProgressBar label="Backup" detail="Done" value={100} tone="green" />
    </div>
  ),
};

const STATE_KEYS = Object.keys(SYNC_STATES) as readonly SyncState[];

export const Statuses: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-5)', padding: 'var(--space-7)', alignItems: 'center' }}>
      {STATE_KEYS.map((state) => (
        <div key={state} style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'center' }}>
          <StatusGlyph state={state} />
          <span className="mono-data" style={{ color: 'var(--text-faint)' }}>
            {state}
          </span>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Every state renders with the design's exact label.
    for (const state of STATE_KEYS) {
      await expect(canvas.getByRole('img', { name: SYNC_STATES[state].label })).toBeInTheDocument();
    }
    // The syncing glyph spins (keyframes applied to its svg).
    const syncing = canvas.getByRole('img', { name: 'Uploading…' });
    const svg = syncing.querySelector('svg');
    if (svg === null) throw new Error('syncing svg missing');
    await expect(getComputedStyle(svg).animationName).toBe('ovl-spin');
  },
};

export const Metadata: StoryObj = {
  render: () => (
    <div style={{ padding: 'var(--space-7)', maxWidth: 320 }}>
      <MetadataRow label="File" value="IMG_4021.RAF" />
      <MetadataRow label="Size" value="26.1 MP · 6240×4160 · 54.2 MB" />
      <MetadataRow label="Camera" value="FUJIFILM X-T5" />
      <MetadataRow label="Backup" value="ENCRYPTED · PCLOUD · 2H AGO" tone="var(--accent-green)" />
      <MetadataRow label="Place" value="Kyoto, Japan" mono={false} />
    </div>
  ),
};
