import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import './shell.css';
import { formatCount, formatRelativeTime } from '../../../shared/library/format.js';
import type { AlbumSummary, LibraryStats, SourceCounts } from '../../../shared/library/types.js';
import { Icon } from '../components/Icon';
import { TitleBar } from '../components/TitleBar';
import { ToastHost, type ToastItem } from '../components/Toast';
import { LibraryGridView } from '../grid/LibraryGridView';
import { fullUrl } from '../../../shared/library/full-url.js';
import { ExportDialog } from '../export/ExportDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { ImportDialog } from '../import/ImportDialog';
import { Inspector } from '../inspector/Inspector';
import { Lightbox } from '../lightbox/Lightbox';
import { useAppState, useAppDispatch } from '../state/app-state-context';
import { useGlobalKeys } from '../state/use-global-keys';
import { RECENT_WINDOW_MS } from '../state/use-library-photos';
import { LibrarySwitcher } from './LibrarySwitcher';
import { MoveResumeBanner } from './MoveResumeBanner';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { ToastAction } from './ToastAction';
import { useOffloadWorkflow } from '../offload/use-offload-workflow';
import { Toolbar } from './Toolbar';
import { InteropWorkflowDialog } from '../interop/InteropWorkflowDialog';
import { blockedInteropWorkflow, type InteropEntryContext } from '../interop/visible-workflow.js';
import { ProtectedAlbumUnlockDialog } from '../protected/ProtectedAlbumUnlockDialog';
import { ProtectedAlbumView } from '../protected/ProtectedAlbumView';
import { createBoundedExternalDropReporter, installExternalFileDropBoundary } from './external-file-drop';

function mergeDropPaths(current: readonly string[] | null, incoming: readonly string[]): readonly string[] {
  return [...new Set([...(current ?? []), ...incoming])];
}

type RestorableDialog = 'export' | 'settings' | 'libraries';

// Composition shell (#73): fixed chrome per README §1. The toolbar, grid,
// sidebar internals, and status bar semantics land with #74–#81 — this keeps
// their regions real (token dims, live counts) so each issue fills in place.
export function Shell({ platform, lockConfigured }: { readonly platform: string; readonly lockConfigured: boolean }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const offload = useOffloadWorkflow();
  useGlobalKeys();

  const [counts, setCounts] = useState<SourceCounts | null>(null);
  // Window drag-and-drop (#237): dropped photo paths pre-seed the dialog's
  // Dropped source; `dragging` shows the full-window overlay.
  const [dropped, setDropped] = useState<readonly string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const dialogStateRef = useRef(state);
  useEffect(() => {
    dialogStateRef.current = state;
  }, [state]);
  const displacedDialogRef = useRef<RestorableDialog | null>(null);
  const openDroppedPaths = useCallback(
    (paths: readonly string[]): void => {
      const current = dialogStateRef.current;
      if (!current.importOpen) {
        displacedDialogRef.current = current.exportOpen
          ? 'export'
          : current.settingsOpen
            ? 'settings'
            : current.librariesOpen
              ? 'libraries'
              : null;
      }
      setDropped((existing) => mergeDropPaths(existing, paths));
      dispatch({ type: 'dialog/set', dialog: 'import', open: true });
    },
    [dispatch],
  );
  const rejectExternalDrop = useCallback((): void => {
    setDropped(null);
    dispatch({ type: 'dialog/set', dialog: 'import', open: false });
    const displacedDialog = displacedDialogRef.current;
    displacedDialogRef.current = null;
    if (displacedDialog !== null) {
      dispatch({ type: 'dialog/set', dialog: displacedDialog, open: true });
    }
    dispatch({ type: 'toast/shown', toast: { title: 'Nothing to import — drop photo files', tone: 'amber' } });
  }, [dispatch]);

  useEffect(() => {
    const boundary = installExternalFileDropBoundary(window, {
      pathForFile: window.overlook.import.pathForFile,
      onDraggingChange: setDragging,
      onPaths: openDroppedPaths,
      onUnsupported: rejectExternalDrop,
      report: createBoundedExternalDropReporter(),
    });
    const offFocus = window.overlook.onFocusChanged(({ focused }) => {
      if (!focused) boundary.reset('window-focus-lost');
    });
    return () => {
      offFocus();
      boundary.dispose();
    };
  }, [openDroppedPaths, rejectExternalDrop]);

  useEffect(() => {
    const unsubscribe = window.overlook.import.onExternalPaths(({ paths }) => {
      openDroppedPaths(paths);
    });
    void window.overlook.import.externalReady();
    return unsubscribe;
  }, [openDroppedPaths]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [albums, setAlbums] = useState<readonly AlbumSummary[]>([]);
  // Current library name for the titlebar trigger (#386). Registry reads
  // never require content access, so this works while locked too.
  const [libraryName, setLibraryName] = useState<string | null>(null);
  useEffect(() => {
    void window.overlook.libraries
      .current()
      .then(({ library }) => setLibraryName(library.name))
      .catch(() => setLibraryName(null));
  }, []);
  const [interopEntry, setInteropEntry] = useState<{ readonly context: InteropEntryContext; readonly total: number } | null>(null);
  const openInterop = (context: InteropEntryContext, records: readonly string[] | number): void => {
    setInteropEntry({ context, total: typeof records === 'number' ? records : records.length });
  };
  const [protectedAlbums, setProtectedAlbums] = useState<
    readonly {
      readonly id: string;
      readonly label: string;
      readonly locked: boolean;
      readonly name?: string | undefined;
      readonly count?: number | undefined;
    }[]
  >([]);
  const [unlockAlbumId, setUnlockAlbumId] = useState<string | null>(null);
  const unlockOriginRef = useRef<HTMLButtonElement | null>(null);

  const refreshProtected = useCallback((): void => {
    void window.overlook.protectedAlbums.list().then(async ({ albums: opaque }) => {
      const visible = await Promise.all(
        opaque.map(async (album) => {
          if (album.locked) return album;
          try {
            const summary = await window.overlook.protectedAlbums.summary({ albumId: album.id });
            return { ...album, name: summary.name, count: summary.count };
          } catch {
            return { ...album, locked: true };
          }
        }),
      );
      setProtectedAlbums(visible);
    });
  }, []);

  useEffect(() => {
    const refreshStats = (): void => {
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
    };
    const refresh = (): void => {
      const recentSince = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
      void window.overlook.library.counts({ recentSince }).then(setCounts);
      refreshStats();
      void window.overlook.library.albums().then(({ albums: loaded }) => {
        setAlbums(loaded);
      });
    };
    refresh();
    refreshProtected();
    // Counts/stats live-update on library mutations (#80 exit criteria) —
    // targeted pushes, never refetch-the-world from the renderer's loops.
    // Per-item pending pushes already update AppStateProvider. Refreshing all
    // summaries for each upload caused 1,500 redundant IPC bursts; completion
    // reconciles stats and the verified-backup stamp once instead.
    const offChanged = window.overlook.library.onChanged(refresh);
    const offStorageChanged = window.overlook.library.onStorageChanged(refresh);
    const offCompleted = window.overlook.backup.onCompleted(refresh);
    const offProtectedChanged = window.overlook.protectedAlbums.onChanged(() => {
      refresh();
      refreshProtected();
    });
    return () => {
      offChanged();
      offStorageChanged();
      offCompleted();
      offProtectedChanged();
    };
  }, [dispatch, refreshProtected]);

  // Settings truth (#113): seed the reducer's sortOrder from the store and
  // follow changed pushes — a sort change in the dialog re-orders the grid
  // live via the query hook's refetch.
  useEffect(() => {
    const syncProvider = (selectedId: string | null): void => {
      void window.overlook.backup.providers().then(({ providers, defaultProviderId }) => {
        const providerId = providers.some((provider) => provider.id === selectedId) ? (selectedId ?? defaultProviderId) : defaultProviderId;
        const descriptor = providers.find((provider) => provider.id === providerId);
        if (descriptor === undefined) {
          dispatch({ type: 'provider/set', connected: false, label: 'Cloud' });
          return;
        }
        void window.overlook.backup
          .providerStatus({ providerId })
          .then(({ connected, provider }) => {
            dispatch({ type: 'provider/set', connected, label: provider.label });
          })
          .catch(() => {
            dispatch({ type: 'provider/set', connected: false, label: descriptor.label });
          });
      });
    };
    void window.overlook.settings.get().then(({ settings }) => {
      dispatch({ type: 'sortOrder/set', order: settings.sortOrder });
      syncProvider(settings.providerId);
    });
    return window.overlook.settings.onChanged(({ settings }) => {
      dispatch({ type: 'sortOrder/set', order: settings.sortOrder });
      syncProvider(settings.providerId);
    });
  }, [dispatch]);

  // Backup completion (#106): failures surface as the red toast with a
  // Retry action; the pending/count refresh rides the existing pushes.
  useEffect(() => {
    return window.overlook.backup.onCompleted(({ uploaded, failed, manifestUploaded, auto, integrity }) => {
      if (failed > 0) {
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
      } else if (integrity.failed) {
        dispatch({
          type: 'toast/shown',
          toast: { title: 'BACKUP CHECK INCOMPLETE — WILL RETRY', tone: 'red', action: 'retry-backup' },
        });
      } else if (integrity.unrecoverable > 0) {
        dispatch({
          type: 'toast/shown',
          toast: { title: `BACKUP DAMAGED: ${formatCount(integrity.unrecoverable)} ORIGINALS MISSING`, tone: 'red' },
        });
      } else if (uploaded > 0 && !auto) {
        const detail = integrity.recoveryRepaired
          ? ' · RECOVERY INDEX REPAIRED'
          : integrity.repaired > 0
            ? ` · ${formatCount(integrity.repaired)} CLOUD COPIES REPAIRED`
            : '';
        dispatch({ type: 'toast/shown', toast: { title: `BACKUP COMPLETE${detail}`, tone: 'green' } });
      } else if (integrity.recoveryRepaired) {
        dispatch({ type: 'toast/shown', toast: { title: 'BACKUP RECOVERY INDEX REPAIRED', tone: 'green' } });
      } else if (integrity.repaired > 0) {
        dispatch({
          type: 'toast/shown',
          toast: { title: `BACKUP REPAIRED: ${formatCount(integrity.repaired)} CLOUD COPIES`, tone: 'green' },
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

  const toast = state.toast;
  const toastItems = useMemo<readonly ToastItem[]>(
    () =>
      toast === null
        ? []
        : [
            {
              id: 'shell-toast',
              tone: toast.tone,
              title: toast.title,
              ...(toast.action === undefined ? {} : { action: <ToastAction toast={toast} /> }),
            },
          ],
    [toast],
  );

  return (
    // OS file drops are owned by the capture-boundary effect above, including
    // portals outside this subtree. The toolbar Import button remains the
    // non-drag equivalent required by SC 2.5.7.
    <div className="ovl-shell">
      {dragging ? (
        <div className="ovl-shell__dropOverlay">
          <div className="ovl-shell__dropCard">
            <Icon name="image-down" size={40} color="var(--accent-cyan)" />
            <div className="ovl-shell__dropTitle">Drop photos to import</div>
            <div className="ovl-shell__dropHint mono-data">Encrypted on this device · RAW, JPEG, PNG, HEIC</div>
          </div>
        </div>
      ) : null}
      <TitleBar
        platform={platform}
        center={
          <button
            type="button"
            className="ovl-library-trigger"
            data-testid="library-trigger"
            aria-label={`Switch library — ${libraryName ?? 'Overlook'}`}
            onClick={() => {
              dispatch({ type: 'dialog/set', dialog: 'libraries', open: true });
            }}
          >
            <Icon name="images" size={13} />
            <span>{libraryName ?? 'Overlook'}</span>
            <Icon name="chevrons-up-down" size={12} color="var(--text-faint)" />
          </button>
        }
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
      <MoveResumeBanner />
      <Toolbar
        onLock={lockConfigured ? () => void window.overlook.appLock.lockNow() : undefined}
        onImport={() => {
          // #237: the dialog owns source discovery (SD scan, folder picker,
          // no-card empty state) — the toolbar just opens it.
          setDropped(null);
          dispatch({ type: 'dialog/set', dialog: 'import', open: true });
        }}
        onTransfer={() => openInterop(state.selection.size > 0 ? 'selection' : 'settings', [...state.selection])}
      />
      {state.importOpen ? (
        <ImportDialog
          open
          dropped={dropped}
          onClose={() => {
            setDropped(null);
            displacedDialogRef.current = null;
            dispatch({ type: 'dialog/set', dialog: 'import', open: false });
          }}
          onDone={() => {
            // "Show in library" jumps to Recent imports (#88).
            dispatch({ type: 'source/set', source: 'recent' });
          }}
          onRejectedDrop={rejectExternalDrop}
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
      {offload.dialog}
      {state.librariesOpen ? (
        <LibrarySwitcher
          onClose={() => {
            dispatch({ type: 'dialog/set', dialog: 'libraries', open: false });
          }}
        />
      ) : null}
      {state.settingsOpen ? (
        <SettingsDialog
          open
          selectedPhotoIds={[...state.selection]}
          onTransfer={() => openInterop('settings', [...state.selection])}
          onClose={() => {
            dispatch({ type: 'dialog/set', dialog: 'settings', open: false });
          }}
        />
      ) : null}
      {unlockAlbumId === null ? null : (
        <ProtectedAlbumUnlockDialog
          key={unlockAlbumId}
          albumId={unlockAlbumId}
          onClose={() => {
            setUnlockAlbumId(null);
            const origin = unlockOriginRef.current;
            unlockOriginRef.current = null;
            requestAnimationFrame(() => origin?.isConnected === true && origin.focus());
          }}
          onDone={(outcome) => {
            const albumId = unlockAlbumId;
            setUnlockAlbumId(null);
            unlockOriginRef.current = null;
            refreshProtected();
            if (outcome === 'opened') {
              dispatch({ type: 'protectedAlbum/set', albumId });
              return;
            }
            dispatch({
              type: 'toast/shown',
              toast: {
                title: outcome === 'protection-completed' ? 'Protection completed — unlock again to open' : 'Protection removed safely',
                tone: 'green',
              },
            });
          }}
        />
      )}
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
            onTransfer={() => openInterop('lightbox', [current.id])}
            onOffload={() => {
              offload.open([current.id], false, () => dispatch({ type: 'lightbox/closed' }));
            }}
            suppressRehydrate={offload.activePhotoIds?.includes(current.id) === true}
            onRehydrateError={() => {
              dispatch({
                type: 'toast/shown',
                toast: { title: `RESTORE FAILED — STILL IN ${state.providerLabel.toUpperCase()}`, tone: 'red', action: 'retry-backup' },
              });
            }}
            onRepairDimensions={(width, height) => {
              void window.overlook.library.repairDimensions({ id: current.id, width, height }).then(({ pendingCount }) => {
                dispatch({ type: 'pendingCount/set', count: pendingCount });
              });
            }}
            onDelete={() => {
              // Soft delete (#120): the change push drops the row from the
              // visible set, which closes the lightbox in the reducer.
              void window.overlook.library.delete({ photoIds: [current.id] }).then(() => {
                dispatch({ type: 'toast/shown', toast: { title: 'Moved 1 photo to Recently deleted', tone: 'neutral' } });
              });
            }}
          />
        );
      })()}
      <div className="ovl-shell__body">
        <Sidebar
          counts={counts}
          stats={stats}
          albums={albums}
          onTransferAlbum={(album) => openInterop('album', album.count)}
          protectedAlbums={protectedAlbums}
          onProtectedOpen={(albumId, origin) => {
            const album = protectedAlbums.find((candidate) => candidate.id === albumId);
            if (album?.locked === false) {
              dispatch({ type: 'protectedAlbum/set', albumId });
              return;
            }
            unlockOriginRef.current = origin;
            setUnlockAlbumId(albumId);
          }}
        />
        <main className="ovl-shell__content" data-testid="content-region">
          {state.protectedAlbum === null ? (
            <LibraryGridView
              knownTotal={counts === null ? null : counts[state.source]}
              activeAlbum={albums.find((album) => album.id === state.album) ?? null}
              onOffload={offload.open}
              onTransfer={openInterop}
            />
          ) : (
            <ProtectedAlbumView
              key={state.protectedAlbum}
              albumId={state.protectedAlbum}
              onRelocked={() => {
                dispatch({ type: 'protectedAlbum/set', albumId: null });
                refreshProtected();
                dispatch({ type: 'toast/shown', toast: { title: 'Protected album relocked', tone: 'neutral' } });
              }}
            />
          )}
        </main>
        {state.inspectorOpen && state.protectedAlbum === null ? (
          <aside className="ovl-shell__inspector" aria-label="Inspector">
            <Inspector
              providerLabel={state.providerLabel}
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
      <ToastHost className="ovl-shell__toast" toasts={toastItems} onDismiss={() => dispatch({ type: 'toast/dismissed' })} />
      <StatusBar stats={stats} />
      {interopEntry === null ? null : (
        <InteropWorkflowDialog
          state={blockedInteropWorkflow(interopEntry.context, interopEntry.total)}
          onClose={() => setInteropEntry(null)}
        />
      )}
    </div>
  );
}
