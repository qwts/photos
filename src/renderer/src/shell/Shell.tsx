import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import './shell.css';
import type { SourceCounts, SourceFilter } from '../../../shared/library/types.js';
import { TitleBar } from '../components/TitleBar';
import { useAppState, useAppDispatch } from '../state/app-state-context';
import { useGlobalKeys } from '../state/use-global-keys';

const SOURCES: readonly { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All Photos' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'recent', label: 'Recent imports' },
  { key: 'offloaded', label: 'Offloaded' },
  { key: 'deleted', label: 'Recently deleted' },
];

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

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
    void window.overlook.library.stats().then(setStats);
    void window.overlook.library.page({ source: 'all', limit: 100 }).then(({ photos }) => {
      dispatch({ type: 'photos/loaded', photos, append: false });
    });
  }, [dispatch]);

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
      <div className="ovl-shell__toolbar">
        <span className="mono-data" style={{ letterSpacing: 'var(--tracking-wide)', color: 'var(--text-body)' }}>
          Overlook
        </span>
        <span className="mono-data" style={{ color: 'var(--text-faint)' }}>
          Toolbar — #79
        </span>
      </div>
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
          <div style={{ padding: 'var(--space-7)' }}>
            <p style={{ margin: 0 }}>Overlook — shell placeholder</p>
            <p className="mono-data" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-4)' }}>
              {formatCount(state.photos.length)} loaded · grid lands with #76
            </p>
          </div>
        </main>
        {state.inspectorOpen ? (
          <aside className="ovl-shell__inspector" aria-label="Inspector">
            <span className="mono-data" style={{ color: 'var(--text-faint)' }}>
              Inspector — M06
            </span>
          </aside>
        ) : null}
      </div>
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
