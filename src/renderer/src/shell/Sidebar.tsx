import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { formatBytes, formatCount } from '../../../shared/library/format.js';
import type { AlbumSummary, LibraryStats, SourceCounts, SourceFilter } from '../../../shared/library/types.js';
import { Icon, type IconName } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';
import { Tooltip } from '../components/Tooltip';
import { useAppState, useAppDispatch } from '../state/app-state-context';

// The shell stylesheet carries the sidebar/rail rules; importing it here
// (not just in Shell) keeps the component styled when mounted alone, e.g.
// by its stories (PR #245).
import './shell.css';

const SOURCES: readonly { key: SourceFilter; icon: IconName; label: string }[] = [
  { key: 'all', icon: 'images', label: 'All Photos' },
  { key: 'favorites', icon: 'star', label: 'Favorites' },
  { key: 'recent', icon: 'download', label: 'Recent imports' },
  { key: 'offloaded', icon: 'cloud', label: 'Offloaded' },
  { key: 'deleted', icon: 'trash-2', label: 'Recently deleted' },
];

// Collapsed state persists across launches under the mock's own key (#238).
const COLLAPSE_KEY = 'overlook.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

interface SideRowProps {
  readonly icon: IconName;
  readonly label: string;
  readonly count: number | null;
  readonly active?: boolean;
  readonly onClick?: (() => void) | undefined;
  readonly collapsed?: boolean;
}

function SideRow({ icon, label, count, active = false, onClick, collapsed = false }: SideRowProps): ReactElement {
  const hint = count === null ? label : `${label} · ${formatCount(count)}`;
  const row = (
    <button
      type="button"
      className={`ovl-siderow${active ? ' ovl-siderow--active' : ''}${collapsed ? ' ovl-siderow--collapsed' : ''}`}
      onClick={onClick}
      disabled={onClick === undefined}
      // Collapsed rows are icon-only; the hint is their accessible name.
      aria-label={collapsed ? hint : undefined}
    >
      <Icon name={icon} size={14} color={active ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
      {collapsed ? null : <span className="ovl-siderow__label">{label}</span>}
      {collapsed || count === null ? null : <span className="ovl-siderow__count mono-data">{formatCount(count)}</span>}
    </button>
  );
  // The rail keeps every destination reachable: the hidden label (and count)
  // move into a right-side tooltip, unclipped by the nav's own overflow.
  return collapsed ? (
    <Tooltip label={hint} side="right">
      {row}
    </Tooltip>
  ) : (
    row
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
  // Collapse to the 56px icon rail (#238): labels/counts move to tooltips,
  // headings become dividers, the backup card becomes the shield button.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = (): void => {
    const next = !collapsed;
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      // Persistence is best-effort; the in-session toggle still works.
    }
    setCollapsed(next);
  };
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
    <nav className={`ovl-sidebar${collapsed ? ' ovl-sidebar--collapsed' : ''}`} aria-label="Library">
      <div className="ovl-sidebar__toggle-row">
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
          <button
            type="button"
            className="ovl-sidebar__toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} size={15} />
          </button>
        </Tooltip>
      </div>
      {collapsed ? (
        <div className="ovl-sidebar__divider" role="presentation" />
      ) : (
        <div className="ovl-sidebar__heading mono-data">Library</div>
      )}
      {SOURCES.filter(
        // Offloaded only earns its row once something is actually offloaded
        // (#268) — no in-app flow drives offload yet, so an always-empty
        // destination reads as broken. Unknown counts keep it hidden too;
        // it appears the moment real rows exist.
        ({ key }) => key !== 'offloaded' || (counts !== null && counts.offloaded > 0),
      ).map(({ key, icon, label }) => (
        <SideRow
          key={key}
          icon={icon}
          label={label}
          count={counts === null ? null : counts[key]}
          active={state.album === null && state.source === key}
          collapsed={collapsed}
          onClick={() => {
            dispatch({ type: 'source/set', source: key });
          }}
        />
      ))}
      {collapsed ? (
        <div className="ovl-sidebar__divider" role="presentation" />
      ) : (
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
      )}
      {namingAlbum && !collapsed ? (
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
          collapsed={collapsed}
          onClick={() => {
            dispatch({ type: 'album/set', albumId: album.id });
          }}
        />
      ))}
      <div className="ovl-sidebar__spacer" />
      {collapsed ? (
        <Tooltip label={`Library encrypted${backupRun !== null && backupRun.done < backupRun.total ? ' · backing up' : ''}`} side="right">
          <button
            type="button"
            className="ovl-sidebar__shield"
            data-testid="backup-shield"
            aria-label="Library encrypted — open Settings"
            onClick={() => {
              dispatch({ type: 'dialog/set', dialog: 'settings', open: true });
            }}
          >
            <Icon name="shield-check" size={15} color="var(--accent-green)" />
          </button>
        </Tooltip>
      ) : (
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
          {state.providerConnected && backupRun !== null && backupRun.done < backupRun.total ? (
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
              : state.providerConnected
                ? `${formatBytes(stats.bytes - stats.offloadedBytes).toUpperCase()} LOCAL · ${formatBytes(stats.offloadedBytes).toUpperCase()} PCLOUD`
                : `${formatBytes(stats.bytes - stats.offloadedBytes).toUpperCase()} LOCAL`}
          </div>
          {state.providerConnected ? null : (
            // Disconnected (#239): say so and offer the path back — never a
            // fabricated backup figure.
            <button
              type="button"
              className="ovl-sidebar__connect"
              data-testid="sidebar-connect"
              onClick={() => {
                dispatch({ type: 'dialog/set', dialog: 'settings', open: true });
              }}
            >
              <Icon name="cloud-off" size={12} color="var(--text-faint)" />
              <span>
                pCloud not connected — <span className="ovl-sidebar__connect-cta">Connect</span>
              </span>
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
