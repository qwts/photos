import type { ReactElement } from 'react';

import { formatBytes, formatCount } from '../../../shared/library/format.js';
import type { AlbumSummary, LibraryStats, SourceCounts, SourceFilter } from '../../../shared/library/types.js';
import { Icon, type IconName } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';
import { useAppState, useAppDispatch } from '../state/app-state-context';

const SOURCES: readonly { key: SourceFilter; icon: IconName; label: string }[] = [
  { key: 'all', icon: 'images', label: 'All Photos' },
  { key: 'favorites', icon: 'star', label: 'Favorites' },
  { key: 'recent', icon: 'download', label: 'Recent imports' },
  { key: 'offloaded', icon: 'cloud', label: 'Offloaded' },
  { key: 'deleted', icon: 'trash-2', label: 'Recently deleted' },
];

interface SideRowProps {
  readonly icon: IconName;
  readonly label: string;
  readonly count: number | null;
  readonly active?: boolean;
  readonly onClick?: (() => void) | undefined;
}

function SideRow({ icon, label, count, active = false, onClick }: SideRowProps): ReactElement {
  return (
    <button
      type="button"
      className={`ovl-siderow${active ? ' ovl-siderow--active' : ''}`}
      onClick={onClick}
      disabled={onClick === undefined}
    >
      <Icon name={icon} size={14} color={active ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
      <span className="ovl-siderow__label">{label}</span>
      {count === null ? null : <span className="ovl-siderow__count mono-data">{formatCount(count)}</span>}
    </button>
  );
}

export interface SidebarProps {
  readonly counts: SourceCounts | null;
  readonly stats: LibraryStats | null;
  readonly albums: readonly AlbumSummary[];
}

// The 216px navigation rail (#80) per the design's Sidebar.jsx. Albums are
// display-only until M10's CRUD (the + affordance is inert); the backup card
// shows the encrypted badge, the M09 settings entry (stub toast), an inert
// ProgressBar slot while photos are pending (live in M08), and the mono
// storage line (cloud share joins in M08).
export function Sidebar({ counts, stats, albums }: SidebarProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  return (
    <nav className="ovl-sidebar" aria-label="Library">
      <div className="ovl-sidebar__heading mono-data">Library</div>
      {SOURCES.map(({ key, icon, label }) => (
        <SideRow
          key={key}
          icon={icon}
          label={label}
          count={counts === null ? null : counts[key]}
          active={state.source === key}
          onClick={() => {
            dispatch({ type: 'source/set', source: key });
          }}
        />
      ))}
      <div className="ovl-sidebar__heading mono-data">
        <span>Albums</span>
        <Icon name="plus" size={13} color="var(--text-faint)" />
      </div>
      {albums.map((album) => (
        <SideRow key={album.id} icon="album" label={album.name} count={album.count} />
      ))}
      <div className="ovl-sidebar__spacer" />
      <div className="ovl-sidebar__card" data-testid="backup-card">
        <div className="ovl-sidebar__card-head">
          <Icon name="shield-check" size={14} color="var(--accent-green)" />
          <span className="ovl-sidebar__card-title">Library encrypted</span>
          <button
            type="button"
            className="ovl-sidebar__gear"
            aria-label="Settings"
            onClick={() => {
              dispatch({ type: 'toast/shown', toast: { title: 'SETTINGS LANDS WITH M09', tone: 'neutral' } });
            }}
          >
            <Icon name="settings-2" size={13} color="var(--text-faint)" />
          </button>
        </div>
        {state.pendingCount > 0 ? (
          <ProgressBar
            label="Backing up"
            detail={`0 / ${formatCount(state.pendingCount)}`}
            value={0}
            max={state.pendingCount}
            tone="amber"
          />
        ) : null}
        <div className="ovl-sidebar__storage mono-data">
          {stats === null ? '—' : `${formatBytes(stats.bytes).toUpperCase()} LOCAL · PCLOUD JOINS M08`}
        </div>
      </div>
    </nav>
  );
}
