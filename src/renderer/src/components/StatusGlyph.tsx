import type { ReactElement } from 'react';

import './feedback.css';
import { Icon, type IconName, type IconSize } from './Icon';

export type SyncState = 'local' | 'synced' | 'syncing' | 'offloaded' | 'error';

// The design's STATES map, verbatim (media/StatusGlyph.jsx) — labels included.
export const SYNC_STATES: Record<SyncState, { icon: IconName; color: string; label: string }> = {
  local: { icon: 'hard-drive', color: 'var(--text-muted)', label: 'Local only' },
  synced: { icon: 'cloud-check', color: 'var(--accent-green)', label: 'Backed up (encrypted)' },
  syncing: { icon: 'refresh-cw', color: 'var(--accent-amber)', label: 'Uploading…' },
  offloaded: { icon: 'cloud', color: 'var(--accent-amber)', label: 'Offloaded to pCloud' },
  error: { icon: 'cloud-alert', color: 'var(--accent-red)', label: 'Sync failed' },
};

export interface StatusGlyphProps {
  readonly state: SyncState;
  /** Capsule diameter; the glyph renders at 60% of it (20 → 12). */
  readonly size?: 18 | 20 | 22;
  readonly title?: string;
}

export function StatusGlyph({ state, size = 20, title }: StatusGlyphProps): ReactElement {
  const s = SYNC_STATES[state];
  const iconSize = Math.round(size * 0.6) as IconSize;
  return (
    <span
      role="img"
      aria-label={title ?? s.label}
      title={title ?? s.label}
      className={`ovl-status-glyph${state === 'syncing' ? ' ovl-status-glyph--syncing' : ''}`}
      style={{ width: size, height: size, color: s.color }}
    >
      <Icon name={s.icon} size={iconSize} strokeWidth={2} />
    </span>
  );
}
