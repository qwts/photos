import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import './shell.css';
import type { SourceCounts, SourceFilter } from '../../../shared/library/types.js';
import { formatCount } from '../../../shared/library/format.js';
import { TitleBar } from '../components/TitleBar';
import { Toast } from '../components/Toast';
import { LibraryGridView } from '../grid/LibraryGridView';
import { useAppState, useAppDispatch } from '../state/app-state-context';
import { useGlobalKeys } from '../state/use-global-keys';
import { RECENT_WINDOW_MS } from '../state/use-library-photos';
import { Toolbar } from './Toolbar';

const TOAST_DISMISS_MS = 3200;

const SOURCES: readonly { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All Photos' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'recent', label: 'Recent imports' },
  { key: 'offloaded', label: 'Offloaded' },
  { key: 'deleted', label: 'Recently deleted' },
];

// Composition shell (#73): fixed chrome per README §1. The toolbar, grid,
// sidebar internals, and status bar semantics land with #74–#81 — this keeps
// their regions real (token dims, live counts) so each issue fills in place.
export function Shell({ platform }: { readonly platform: string }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  useGlobalKeys();

  const [counts, setCounts] = useState<SourceCounts | null>(null);
  const [stats, setStats] = useState<{ photos: number; bytes: number } | null>(null);

  useEffect(() => {
    const recentSince = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    void window.overlook.library.counts({ recentSince }).then(setCounts);
    void window.overlook.library.stats().then((loaded) => {
      setStats(loaded);
      // Seed the backup state (#79); pushes keep it live afterwards.
      dispatch({ type: 'pendingCount/set', count: loaded.pending });
    });
  }, [dispatch]);

  // Stub toasts (#79) auto-dismiss; real flows may pin their own later.
  const toast = state.toast;
  useEffect(() => {
    if (toast === null) {
      return;
    }
    const timer = setTimeout(() => {
      dispatch({ type: 'toast/dismissed' });
    }, TOAST_DISMISS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast, dispatch]);

  return (
    <div className="ovl-shell">
      <TitleBar
        platform={platform}
        onMinimize={() => {
          void window.overlook.minimizeWindow();
        }}
        onToggleMaximize={() => {
          void window.overlook.toggleMaximizeWindow();
        }}
        onClose={() => {
          void window.overlook.closeWindow();
        }}
      />
      <Toolbar />
      <div className="ovl-shell__body">
        <nav className="ovl-shell__sidebar" aria-label="Library">
          {SOURCES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`ovl-shell__source-row${state.source === key ? ' ovl-shell__source-row--active' : ''}`}
              onClick={() => {
                dispatch({ type: 'source/set', source: key });
              }}
            >
              <span>{label}</span>
              <span className="mono-data" style={{ color: 'var(--text-faint)' }}>
                {counts === null ? '—' : formatCount(counts[key])}
              </span>
            </button>
          ))}
        </nav>
        <main className="ovl-shell__content" data-testid="content-region">
          <LibraryGridView knownTotal={counts === null ? null : counts[state.source]} />
        </main>
        {state.inspectorOpen ? (
          <aside className="ovl-shell__inspector" aria-label="Inspector">
            <span className="mono-data" style={{ color: 'var(--text-faint)' }}>
              Inspector — M06
            </span>
          </aside>
        ) : null}
      </div>
      {toast === null ? null : (
        <div className="ovl-shell__toast">
          <Toast tone={toast.tone} title={toast.title} />
        </div>
      )}
      <footer className="ovl-shell__statusbar">
        <span className="mono-data" style={{ color: 'var(--text-muted)' }} data-testid="statusbar-left">
          {stats === null ? '—' : `${formatCount(stats.photos)} PHOTOS`}
        </span>
        <span className="mono-data" style={{ color: 'var(--text-faint)' }}>
          AES-256
        </span>
      </footer>
    </div>
  );
}
