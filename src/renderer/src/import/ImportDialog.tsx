import { useEffect, useState, type ReactElement } from 'react';

import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';
import { Segmented } from '../components/Segmented';
import { Switch } from '../components/Switch';
import { formatBytes, formatCount } from '../../../shared/library/format.js';

import './import.css';

// ImportDialog (#88, sources reworked by #237): the design's 440px import
// flow over the real engine. A segmented source picker — SD card / Local
// folder, plus Dropped when the window drop opened the dialog — feeds the
// same options → running (two aggregate bars) → done flow. Move is offered
// ONLY for the SD card; folder and dropped imports force Copy so the app
// never deletes a user's own files (the service enforces it again). The
// host mounts a fresh instance per invocation, so state needs no reset.

export type ImportSourceKind = 'sd' | 'folder' | 'drop';

interface ScanSummary {
  readonly newCount: number;
  readonly newBytes: number;
  readonly newRaw: number;
  readonly newJpg: number;
}

/** The source card's mono line — "1,204 NEW · 38.2 GB · 812 RAW / 392 JPG". */
function summaryDetail(summary: ScanSummary): string {
  return `${formatCount(summary.newCount)} NEW · ${formatBytes(summary.newBytes)} · ${formatCount(summary.newRaw)} RAW / ${formatCount(summary.newJpg)} JPG`;
}

type SdState =
  | { readonly status: 'scanning' }
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly path: string; readonly label: string; readonly summary: ScanSummary };

type FolderState =
  | { readonly status: 'empty' }
  | { readonly status: 'scanning'; readonly path: string }
  | { readonly status: 'ready'; readonly path: string; readonly summary: ScanSummary };

type DropState = { readonly status: 'scanning' } | { readonly status: 'ready'; readonly summary: ScanSummary };

export interface ImportDialogProps {
  readonly open: boolean;
  /** Paths dropped onto the window (#237); null when opened from the toolbar. */
  readonly dropped: readonly string[] | null;
  readonly onClose: () => void;
  /** "Show in library" — the shell jumps to Recent imports (E6.7). */
  readonly onDone: () => void;
  /** Clean completion (no failures): feeds the green toast (#89). Fired
   * when the dialog CLOSES — never while the modal scrim still covers the
   * toast layer and burns its 4s timer (PR #185 review). */
  readonly onComplete?: ((imported: number) => void) | undefined;
}

type Phase = 'options' | 'running' | 'done';

interface Bar {
  readonly done: number;
  readonly total: number;
}

export function ImportDialog({ open, dropped, onClose, onDone, onComplete }: ImportDialogProps): ReactElement | null {
  const [phase, setPhase] = useState<Phase>('options');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [source, setSource] = useState<ImportSourceKind>(dropped === null ? 'sd' : 'drop');
  const [sd, setSd] = useState<SdState>({ status: 'scanning' });
  const [folder, setFolder] = useState<FolderState>({ status: 'empty' });
  const [drop, setDrop] = useState<DropState>({ status: 'scanning' });

  // "On import" is the SAME setting as Settings → Storage & Backup (#114):
  // the dialog opens with the stored preference and a change here persists
  // back — the host mounts a fresh instance per invocation.
  useEffect(() => {
    void window.overlook.settings.get().then(({ settings }) => {
      setMode(settings.importMode);
    });
  }, []);
  const chooseMode = (importMode: 'copy' | 'move'): void => {
    setMode(importMode);
    void window.overlook.settings.set({ patch: { importMode } }).catch(() => undefined);
  };

  // SD discovery (#237): the first mounted volume, scanned for the card.
  useEffect(() => {
    let stale = false;
    void window.overlook.import
      .listSources()
      .then(async ({ sources }) => {
        const volume = sources.find((candidate) => candidate.kind === 'volume');
        if (volume === undefined) {
          if (!stale) {
            setSd({ status: 'none' });
          }
          return;
        }
        const summary = await window.overlook.import.scanSource({ path: volume.path });
        if (!stale) {
          setSd({ status: 'ready', path: volume.path, label: volume.label, summary });
        }
      })
      .catch(() => {
        if (!stale) {
          setSd({ status: 'none' });
        }
      });
    return () => {
      stale = true;
    };
  }, []);

  // Dropped files (#237): scanned through the same allowlist + NEW dedupe.
  useEffect(() => {
    if (dropped === null) {
      return;
    }
    let stale = false;
    void window.overlook.import
      .scanFiles({ paths: [...dropped] })
      .then((summary) => {
        if (!stale) {
          setDrop({ status: 'ready', summary });
        }
      })
      .catch(() => {
        if (!stale) {
          setDrop({ status: 'ready', summary: { newCount: 0, newBytes: 0, newRaw: 0, newJpg: 0 } });
        }
      });
    return () => {
      stale = true;
    };
  }, [dropped]);

  const chooseFolder = (): void => {
    void window.overlook.import
      .pickFolder()
      .then(async ({ path }) => {
        if (path === null) {
          return;
        }
        setFolder({ status: 'scanning', path });
        const summary = await window.overlook.import.scanSource({ path });
        setFolder({ status: 'ready', path, summary });
      })
      .catch(() => {
        setFolder({ status: 'empty' });
      });
  };

  const [copyBar, setCopyBar] = useState<Bar>({ done: 0, total: 0 });
  const [thumbBar, setThumbBar] = useState<Bar>({ done: 0, total: 0 });
  const [imported, setImported] = useState(0);
  const [failed, setFailed] = useState(0);
  const [runError, setRunError] = useState(false);
  const [cancelled, setCancelled] = useState(0);
  const [cleanCount, setCleanCount] = useState<number | null>(null);

  useEffect(() => {
    if (phase !== 'running') {
      return;
    }
    const offCopy = window.overlook.import.onCopyProgress((payload) => {
      setCopyBar(payload);
    });
    const offThumb = window.overlook.import.onThumbProgress((payload) => {
      setThumbBar(payload);
    });
    return () => {
      offCopy();
      offThumb();
    };
  }, [phase]);

  if (!open) {
    return null;
  }

  const usingSd = source === 'sd';
  const moveAllowed = usingSd; // never delete a user's own files (#237)
  const importMode = moveAllowed ? mode : 'copy';
  const activeSummary =
    source === 'drop'
      ? drop.status === 'ready'
        ? drop.summary
        : null
      : source === 'sd'
        ? sd.status === 'ready'
          ? sd.summary
          : null
        : folder.status === 'ready'
          ? folder.summary
          : null;
  const total = activeSummary?.newCount ?? 0;
  const available = activeSummary !== null && total > 0;

  const close = (showRecent: boolean): void => {
    if (cleanCount !== null) {
      onComplete?.(cleanCount); // the modal is gone — the toast is visible
    }
    if (showRecent) {
      onDone();
    }
    onClose();
  };

  const start = (): void => {
    setPhase('running');
    setCopyBar({ done: 0, total });
    setThumbBar({ done: 0, total });
    const run =
      source === 'drop'
        ? window.overlook.import.run({ files: [...(dropped ?? [])], mode: 'copy' })
        : window.overlook.import.run({
            path: source === 'sd' ? (sd.status === 'ready' ? sd.path : '') : folder.status === 'ready' ? folder.path : '',
            mode: importMode,
          });
    void run
      .then((summary) => {
        setImported(summary.imported);
        setFailed(summary.failed);
        setCancelled(summary.cancelled);
        setPhase('done');
        if (summary.failed === 0 && summary.cancelled === 0) {
          setCleanCount(summary.imported);
        }
      })
      .catch(() => {
        // The run itself died (source vanished mid-scan): nothing on the
        // card was deleted (Move cleanup only follows verification).
        setRunError(true);
        setPhase('done');
      });
  };

  return (
    <Dialog
      open={open}
      title="Import photos"
      icon="download"
      width={440}
      onClose={
        phase === 'running'
          ? () => undefined
          : () => {
              close(false);
            }
      }
      footer={
        phase === 'options' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon="download" disabled={!available} onClick={start}>
              {available ? `Import ${formatCount(total)} photos` : 'Import'}
            </Button>
          </>
        ) : phase === 'running' ? (
          <Button
            variant="ghost"
            onClick={() => {
              // Cancel semantics (#88): the engine finishes the file in
              // flight and keeps everything completed; the run's own
              // resolution moves us to the done summary.
              void window.overlook.import.cancel({});
            }}
          >
            Cancel
          </Button>
        ) : phase === 'done' ? (
          <Button
            variant="primary"
            onClick={() => {
              close(true);
            }}
          >
            Show in library
          </Button>
        ) : null
      }
    >
      {phase === 'options' ? (
        <div className="ovl-import__options">
          <div>
            <div className="ovl-import__pickerLabel mono-data">Import from</div>
            <Segmented
              label="Import from"
              value={source}
              onChange={setSource}
              options={[
                ...(dropped === null ? [] : [{ value: 'drop' as const, icon: 'image' as const, label: 'Dropped' }]),
                { value: 'sd' as const, icon: 'hard-drive' as const, label: 'SD card' },
                { value: 'folder' as const, icon: 'folder' as const, label: 'Local folder' },
              ]}
            />
          </div>
          {source === 'drop' ? (
            drop.status === 'ready' ? (
              <div className="ovl-import__card" data-testid="import-source-card">
                <Icon name="image" size={16} color="var(--accent-cyan)" />
                <div className="ovl-import__cardText">
                  <div className="ovl-import__cardTitle">
                    {formatCount(drop.summary.newCount)} photo{drop.summary.newCount === 1 ? '' : 's'} ready to import
                  </div>
                  <div className="ovl-import__cardMeta mono-data">{summaryDetail(drop.summary)}</div>
                </div>
              </div>
            ) : (
              <div className="ovl-import__card">
                <Icon name="image" size={16} />
                <div className="ovl-import__cardText">
                  <div className="ovl-import__cardMeta mono-data">Scanning dropped files…</div>
                </div>
              </div>
            )
          ) : usingSd ? (
            sd.status === 'ready' ? (
              <div className="ovl-import__card" data-testid="import-source-card">
                <Icon name="hard-drive" size={16} />
                <div className="ovl-import__cardText">
                  <div className="ovl-import__cardTitle">{sd.label}</div>
                  <div className="ovl-import__cardMeta mono-data">{summaryDetail(sd.summary)}</div>
                </div>
              </div>
            ) : sd.status === 'scanning' ? (
              <div className="ovl-import__card">
                <Icon name="hard-drive" size={16} />
                <div className="ovl-import__cardText">
                  <div className="ovl-import__cardMeta mono-data">Looking for cards…</div>
                </div>
              </div>
            ) : (
              <div className="ovl-import__empty" data-testid="import-no-card">
                <Icon name="hard-drive" size={20} color="var(--text-faint)" />
                <div className="ovl-import__emptyTitle">No SD card detected</div>
                <div className="ovl-import__emptyHint">
                  Insert a card, or switch to{' '}
                  <button
                    type="button"
                    className="ovl-import__link"
                    onClick={() => {
                      setSource('folder');
                    }}
                  >
                    Local folder
                  </button>
                  .
                </div>
              </div>
            )
          ) : folder.status === 'ready' || folder.status === 'scanning' ? (
            <div className="ovl-import__card" data-testid="import-source-card">
              <Icon name="folder" size={16} color="var(--accent-cyan)" />
              <div className="ovl-import__cardText">
                <div className="ovl-import__cardPath mono-data">{folder.path}</div>
                <div className="ovl-import__cardMeta mono-data">
                  {folder.status === 'ready' ? summaryDetail(folder.summary) : 'Scanning…'}
                </div>
              </div>
              <button
                type="button"
                className="ovl-import__clear"
                aria-label="Clear folder"
                onClick={() => {
                  setFolder({ status: 'empty' });
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className="ovl-import__empty ovl-import__empty--action" onClick={chooseFolder}>
              <Icon name="folder-open" size={20} color="var(--text-faint)" />
              <div className="ovl-import__emptyTitle">Choose a folder to import</div>
              <div className="ovl-import__emptyHint">Scans for photos, including subfolders</div>
            </button>
          )}
          <Checkbox checked label="Generate thumbnails on import" />
          <div className={`ovl-import__row${moveAllowed ? '' : ' ovl-import__row--locked'}`}>
            <span>On import</span>
            <Segmented
              label="On import"
              value={importMode}
              disabled={!moveAllowed}
              onChange={chooseMode}
              options={[
                { value: 'copy', label: 'Copy' },
                { value: 'move', label: 'Move' },
              ]}
            />
          </div>
          {usingSd && mode === 'move' ? (
            <div className="ovl-import__warning mono-data" role="alert">
              <Icon name="triangle-alert" size={12} />
              Originals will be deleted from the card after import.
            </div>
          ) : !moveAllowed ? (
            <div className="ovl-import__note mono-data">
              <Icon name="info" size={12} />
              Imported files are copied — source files are left untouched.
            </div>
          ) : null}
          <div className="ovl-import__row">
            <Switch checked disabled label="Encrypt originals (always on)" />
            <span className="ovl-import__lock">
              <Icon name="lock" size={13} />
            </span>
          </div>
        </div>
      ) : (
        <div className="ovl-import__running">
          <ProgressBar
            label={importMode === 'move' ? 'Moving & encrypting' : 'Copying & encrypting'}
            tone="green"
            value={copyBar.done}
            max={Math.max(copyBar.total, 1)}
            detail={`${formatCount(copyBar.done)} / ${formatCount(copyBar.total)}`}
          />
          <ProgressBar
            label="Generating thumbnails"
            tone="cyan"
            value={thumbBar.done}
            max={Math.max(thumbBar.total, 1)}
            detail={`${formatCount(thumbBar.done)} / ${formatCount(thumbBar.total)}`}
          />
          {phase === 'done' ? (
            runError || failed > 0 || cancelled > 0 ? (
              <div className="ovl-import__failed" role="alert">
                <Icon name="triangle-alert" size={15} />
                {runError
                  ? 'Import failed — nothing was deleted from the source. Check the source and try again.'
                  : `${[
                      `${formatCount(imported)} imported`,
                      ...(failed > 0 ? [`${formatCount(failed)} failed`] : []),
                      ...(cancelled > 0 ? [`${formatCount(cancelled)} cancelled`] : []),
                    ].join(' · ')} — everything not imported was kept on the source.`}
              </div>
            ) : (
              <div className="ovl-import__done">
                <Icon name="shield-check" size={15} />
                All {formatCount(imported)} photos imported and encrypted.
              </div>
            )
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
