import { useEffect, useState } from 'react';
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
// shows the encrypted badge, the settings gear (opens the M09 dialog), a
// live aggregate bar while a backup runs (#108), and the mono storage line.
export function Sidebar({ counts, stats, albums }: SidebarProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  // The card's aggregate bar rides backup:progress (#108); it hides again
  // when the run finishes (done === total).
  const [backupRun, setBackupRun] = useState<{ done: number; total: number } | null>(null);
  // Inline album creation (#117) — the design gives the + affordance but no
  // flow; an inline name row keeps it keyboard-first (Enter/Escape).
  const [namingAlbum, setNamingAlbum] = useState(false);
  useEffect(() => {
    const offProgress = window.overlook.backup.onProgress(({ done, total }) => {
      setBackupRun(total === 0 ? null : { done, total });
    });
    // Early exits (auth/quota) break before a final done===total event —
    // completion always clears the bar (PR #207 review).
    const offCompleted = window.overlook.backup.onCompleted(() => {
      setBackupRun(null);
    });
    return () => {
      offProgress();
      offCompleted();
    };
  }, []);
  return (
    <nav className="ovl-sidebar" aria-label="Library">
      <div className="ovl-sidebar__heading mono-data">Library</div>
      {SOURCES.map(({ key, icon, label }) => (
        <SideRow
          key={key}
          icon={icon}
          label={label}
          count={counts === null ? null : counts[key]}
          active={state.album === null && state.source === key}
          onClick={() => {
            dispatch({ type: 'source/set', source: key });
          }}
        />
      ))}
      <div className="ovl-sidebar__heading mono-data">
        <span>Albums</span>
        <button
          type="button"
          className="ovl-sidebar__gear"
          aria-label="New album"
          onClick={() => {
            setNamingAlbum(true);
          }}
        >
          <Icon name="plus" size={13} color="var(--text-faint)" />
        </button>
      </div>
      {namingAlbum ? (
        <input
          className="ovl-sidebar__albumname"
          aria-label="Album name"
          placeholder="Album name"
          // The affordance just appeared under the pointer — take focus so
          // Enter/Escape work immediately.
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setNamingAlbum(false);
            } else if (event.key === 'Enter') {
              const name = event.currentTarget.value.trim();
              if (name !== '') {
                // The albums list refreshes off the library:changed push.
                void window.overlook.albums.create({ name }).catch(() => undefined);
                setNamingAlbum(false);
              }
            }
          }}
          onBlur={() => {
            setNamingAlbum(false);
          }}
        />
      ) : null}
      {albums.map((album) => (
        <SideRow
          key={album.id}
          icon="album"
          label={album.name}
          count={album.count}
          active={state.album === album.id}
          onClick={() => {
            dispatch({ type: 'album/set', albumId: album.id });
          }}
        />
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
              dispatch({ type: 'dialog/set', dialog: 'settings', open: true });
            }}
          >
            <Icon name="settings-2" size={13} color="var(--text-faint)" />
          </button>
        </div>
        {backupRun !== null && backupRun.done < backupRun.total ? (
          <ProgressBar
            label="Backing up"
            detail={`${formatCount(backupRun.done)} / ${formatCount(backupRun.total)}`}
            value={backupRun.done}
            max={Math.max(backupRun.total, 1)}
            tone="amber"
          />
        ) : null}
        <div className="ovl-sidebar__storage mono-data">
          {stats === null
            ? '—'
            : `${formatBytes(stats.bytes - stats.offloadedBytes).toUpperCase()} LOCAL · ${formatBytes(stats.offloadedBytes).toUpperCase()} PCLOUD`}
        </div>
      </div>
    </nav>
  );
}
