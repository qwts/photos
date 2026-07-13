import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import './shell.css';
import { formatCount, formatRelativeTime } from '../../../shared/library/format.js';
import type { AlbumSummary, LibraryStats, SourceCounts } from '../../../shared/library/types.js';
import { TitleBar } from '../components/TitleBar';
import { Toast } from '../components/Toast';
import { LibraryGridView } from '../grid/LibraryGridView';
import { fullUrl } from '../../../shared/library/full-url.js';
import { ExportDialog } from '../export/ExportDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { ImportDialog, type ImportDialogSource } from '../import/ImportDialog';
import { Inspector } from '../inspector/Inspector';
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
        // Real stamp (#104): "JUST NOW" / "2H AGO" from the ledger, "NEVER"
        // before the first verified backup.
        dispatch({
          type: 'backupLabel/set',
          label: loaded.lastBackupAt === null ? 'NEVER' : formatRelativeTime(loaded.lastBackupAt, Date.now()),
        });
      });
      void window.overlook.library.albums().then(({ albums: loaded }) => {
        setAlbums(loaded);
      });
    };
    refresh();
    // Counts/stats live-update on library mutations (#80 exit criteria) —
    // targeted pushes, never refetch-the-world from the renderer's loops.
    // Pending pushes ALSO refresh: a completed backup moves pendingCount to
    // 0 without a library:changed, and the "ALL BACKED UP · …" stamp must
    // read the freshly written last_backup_at (PR #202 review).
    const offChanged = window.overlook.library.onChanged(refresh);
    const offPending = window.overlook.library.onPendingCountChanged(refresh);
    return () => {
      offChanged();
      offPending();
    };
  }, [dispatch]);

  // Settings truth (#113): seed the reducer's sortOrder from the store and
  // follow changed pushes — a sort change in the dialog re-orders the grid
  // live via the query hook's refetch.
  useEffect(() => {
    void window.overlook.settings.get().then(({ settings }) => {
      dispatch({ type: 'sortOrder/set', order: settings.sortOrder });
    });
    return window.overlook.settings.onChanged(({ settings }) => {
      dispatch({ type: 'sortOrder/set', order: settings.sortOrder });
    });
  }, [dispatch]);

  // Backup completion (#106): failures surface as the red toast with a
  // Retry action; the pending/count refresh rides the existing pushes.
  useEffect(() => {
    return window.overlook.backup.onCompleted(({ uploaded, failed, manifestUploaded }) => {
      if (failed === 0 && manifestUploaded && uploaded > 0) {
        // Green completion per the mock (#108).
        dispatch({ type: 'toast/shown', toast: { title: 'BACKUP COMPLETE', tone: 'green' } });
      } else if (failed > 0) {
        dispatch({
          type: 'toast/shown',
          toast: { title: `BACKUP: ${formatCount(failed)} FAILED — WILL RETRY`, tone: 'red', action: 'retry-backup' },
        });
      } else if (!manifestUploaded) {
        // Blobs verified but the remote is owed its manifest generation —
        // without it the backup is not restorable (PR #204 review).
        dispatch({
          type: 'toast/shown',
          toast: { title: 'BACKUP INDEX PENDING — WILL RETRY', tone: 'red', action: 'retry-backup' },
        });
      }
    });
  }, [dispatch]);

  // Neighbor prefetch (#91/#93): whenever the lightbox photo changes, warm
  // both adjacent frames so ←/→ (clicks OR keys) never stall.
  const lightboxId = state.lightboxId;
  const photos = state.photos;
  useEffect(() => {
    if (lightboxId === null || photos.length < 2) {
      return;
    }
    const index = photos.findIndex((photo) => photo.id === lightboxId);
    if (index === -1) {
      return;
    }
    for (const hop of [-1, 1]) {
      const neighbor = photos[(index + hop + photos.length) % photos.length];
      if (neighbor !== undefined && neighbor.id !== lightboxId) {
        void fetch(fullUrl(neighbor.id, { prefetch: true })).catch(() => undefined);
      }
    }
  }, [lightboxId, photos]);

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
      {state.exportOpen ? (
        <ExportDialog
          open
          // The focused photo wins (lightbox entry, count=1); otherwise the
          // selection set (#100). Selection is preserved through the flow.
          photoIds={state.lightboxId !== null ? [state.lightboxId] : [...state.selection]}
          onClose={() => {
            dispatch({ type: 'dialog/set', dialog: 'export', open: false });
          }}
        />
      ) : null}
      {state.settingsOpen ? (
        <SettingsDialog
          open
          onClose={() => {
            dispatch({ type: 'dialog/set', dialog: 'settings', open: false });
          }}
        />
      ) : null}
      {(() => {
        // Lightbox (#92): overlay above the shell, driven by reducer state.
        // Arrows and keys (#93) share the reducer's lightbox/stepped
        // wraparound; the effect above prefetches neighbors on every change.
        const index = state.photos.findIndex((photo) => photo.id === state.lightboxId);
        const current = index === -1 ? null : (state.photos[index] ?? null);
        if (current === null) {
          return null;
        }
        return (
          <Lightbox
            photo={current}
            onClose={() => {
              dispatch({ type: 'lightbox/closed' });
            }}
            onPrev={() => {
              dispatch({ type: 'lightbox/stepped', delta: -1 });
            }}
            onNext={() => {
              dispatch({ type: 'lightbox/stepped', delta: 1 });
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
              // Lightbox entry point (#100): count=1, the focused photo.
              dispatch({ type: 'dialog/set', dialog: 'export', open: true });
            }}
            onRehydrateError={() => {
              dispatch({
                type: 'toast/shown',
                toast: { title: 'RESTORE FAILED — STILL IN PCLOUD', tone: 'red', action: 'retry-backup' },
              });
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
            <Inspector
              photo={
                // The focused photo (#94): the lightbox photo wins; else a
                // single grid selection; else the empty hint.
                state.photos.find((photo) => photo.id === state.lightboxId) ??
                (state.selection.size === 1 ? (state.photos.find((photo) => state.selection.has(photo.id)) ?? null) : null)
              }
            />
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
              ) : toast.action === 'retry-backup' ? (
                <button
                  type="button"
                  className="ovl-toast__action"
                  onClick={() => {
                    void window.overlook.backup.run({}).then(({ skipped }) => {
                      if (skipped === 'disconnected') {
                        dispatch({ type: 'toast/shown', toast: { title: 'BACKUP OFF — NOT CONNECTED', tone: 'neutral' } });
                      }
                    });
                    dispatch({ type: 'toast/dismissed' });
                  }}
                >
                  Retry
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
