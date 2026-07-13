import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import './shell.css';
import { formatCount } from '../../../shared/library/format.js';
import type { AlbumSummary, LibraryStats, SourceCounts } from '../../../shared/library/types.js';
import { TitleBar } from '../components/TitleBar';
import { Toast } from '../components/Toast';
import { LibraryGridView } from '../grid/LibraryGridView';
import { fullUrl } from '../../../shared/library/full-url.js';
import { ImportDialog, type ImportDialogSource } from '../import/ImportDialog';
import { Lightbox } from '../lightbox/Lightbox';
import { useAppState, useAppDispatch } from '../state/app-state-context';
import { useGlobalKeys } from '../state/use-global-keys';
import { RECENT_WINDOW_MS } from '../state/use-library-photos';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

// 4s per the design's ToastHost (#89 exit criteria).
const TOAST_DISMISS_MS = 4000;

// Composition shell (#73): fixed chrome per README §1. The toolbar, grid,
// sidebar internals, and status bar semantics land with #74–#81 — this keeps
// their regions real (token dims, live counts) so each issue fills in place.
export function Shell({ platform }: { readonly platform: string }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  useGlobalKeys();

  const [counts, setCounts] = useState<SourceCounts | null>(null);
  const [importSource, setImportSource] = useState<ImportDialogSource | null>(null);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [albums, setAlbums] = useState<readonly AlbumSummary[]>([]);

  useEffect(() => {
    const refresh = (): void => {
      const recentSince = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
      void window.overlook.library.counts({ recentSince }).then(setCounts);
      void window.overlook.library.stats().then((loaded) => {
        setStats(loaded);
        // Seed the backup state (#79); pushes keep it live afterwards.
        dispatch({ type: 'pendingCount/set', count: loaded.pending });
      });
      void window.overlook.library.albums().then(({ albums: loaded }) => {
        setAlbums(loaded);
      });
    };
    refresh();
    // Counts/stats live-update on library mutations (#80 exit criteria) —
    // targeted pushes, never refetch-the-world from the renderer's loops.
    return window.overlook.library.onChanged(refresh);
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
      <Toolbar
        onImport={() => {
          // #88: first available source, scanned for the options card. No
          // source → the design's toast copy.
          void window.overlook.import
            .listSources()
            .then(async ({ sources }) => {
              const source = sources[0];
              if (source === undefined) {
                dispatch({ type: 'toast/shown', toast: { title: 'NO IMPORT SOURCE FOUND', tone: 'neutral' } });
                return;
              }
              const summary = await window.overlook.import.scanSource({ path: source.path });
              setImportSource({ path: source.path, label: source.label, ...summary });
            })
            .catch(() => {
              dispatch({ type: 'toast/shown', toast: { title: 'IMPORT SOURCE SCAN FAILED', tone: 'amber' } });
            });
        }}
      />
      {importSource !== null ? (
        <ImportDialog
          open
          source={importSource}
          onClose={() => {
            setImportSource(null);
          }}
          onDone={() => {
            // "Show in library" jumps to Recent imports (#88).
            dispatch({ type: 'source/set', source: 'recent' });
          }}
          onComplete={(imported) => {
            // Green completion toast with exact counts + Show action (#89).
            dispatch({
              type: 'toast/shown',
              toast: { title: `Imported ${formatCount(imported)} photos`, tone: 'green', action: 'show-recent' },
            });
          }}
        />
      ) : null}
      {(() => {
        // Lightbox (#92): overlay above the shell, driven by reducer state.
        const index = state.photos.findIndex((photo) => photo.id === state.lightboxId);
        const current = index === -1 ? null : (state.photos[index] ?? null);
        if (current === null) {
          return null;
        }
        const go = (delta: number): void => {
          const next = state.photos[(index + delta + state.photos.length) % state.photos.length];
          if (next !== undefined) {
            dispatch({ type: 'lightbox/opened', photoId: next.id });
            // Neighbor prefetch (#91): warm the NEXT hop in each direction.
            for (const hop of [-1, 1]) {
              const neighbor = state.photos[(index + delta + hop + state.photos.length) % state.photos.length];
              if (neighbor !== undefined && neighbor.id !== next.id) {
                void fetch(fullUrl(neighbor.id, { prefetch: true })).catch(() => undefined);
              }
            }
          }
        };
        return (
          <Lightbox
            photo={current}
            onClose={() => {
              dispatch({ type: 'lightbox/closed' });
            }}
            onPrev={() => {
              go(-1);
            }}
            onNext={() => {
              go(1);
            }}
            onToggleFavorite={() => {
              void window.overlook.library.toggleFavorite({ id: current.id }).then(({ pendingCount }) => {
                dispatch({ type: 'pendingCount/set', count: pendingCount });
              });
            }}
            inspectorOpen={state.inspectorOpen}
            onToggleInspector={() => {
              dispatch({ type: 'inspector/toggled' });
            }}
            onExport={() => {
              dispatch({ type: 'toast/shown', toast: { title: 'EXPORT LANDS WITH M07', tone: 'neutral' } });
            }}
          />
        );
      })()}
      <div className="ovl-shell__body">
        <Sidebar counts={counts} stats={stats} albums={albums} />
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
          <Toast
            tone={toast.tone}
            title={toast.title}
            action={
              toast.action === 'show-recent' ? (
                <button
                  type="button"
                  className="ovl-toast__action"
                  onClick={() => {
                    dispatch({ type: 'source/set', source: 'recent' });
                    dispatch({ type: 'toast/dismissed' });
                  }}
                >
                  Show
                </button>
              ) : undefined
            }
          />
        </div>
      )}
      <StatusBar stats={stats} />
    </div>
  );
}
