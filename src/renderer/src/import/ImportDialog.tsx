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

// ImportDialog (#88): the design's 420px import flow over the real engine.
// options → running (two aggregate bars from the engine's streams) → done.
// The host mounts a fresh instance per source, so state needs no reset.
// Copy is design-verbatim (README §5 + Content voice): the Move warning, the
// locked thumbnails checkbox, the always-on encrypt switch.

export interface ImportDialogSource {
  readonly path: string;
  readonly label: string;
  /** From import.scanSource — the card's mono line + button count. */
  readonly newCount: number;
  readonly newBytes: number;
  readonly newRaw: number;
  readonly newJpg: number;
}

export interface ImportDialogProps {
  readonly open: boolean;
  readonly source: ImportDialogSource;
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

export function ImportDialog({ open, source, onClose, onDone, onComplete }: ImportDialogProps): ReactElement | null {
  const [phase, setPhase] = useState<Phase>('options');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');

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
  const [copyBar, setCopyBar] = useState<Bar>({ done: 0, total: source.newCount });
  const [thumbBar, setThumbBar] = useState<Bar>({ done: 0, total: source.newCount });
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
    void window.overlook.import
      .run({ path: source.path, mode })
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
      title="Import from SD card"
      icon="download"
      width={420}
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
            <Button variant="primary" icon="download" onClick={start}>
              Import {formatCount(source.newCount)} photos
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
          <div className="ovl-import__card">
            <Icon name="hard-drive" size={16} />
            <div className="ovl-import__cardText">
              <div className="ovl-import__cardTitle">{source.label}</div>
              <div className="ovl-import__cardMeta mono-data">
                {formatCount(source.newCount)} NEW · {formatBytes(source.newBytes)} · {formatCount(source.newRaw)} RAW /{' '}
                {formatCount(source.newJpg)} JPG
              </div>
            </div>
          </div>
          <Checkbox checked label="Generate thumbnails on import" />
          <div className="ovl-import__row">
            <span>On import</span>
            <Segmented
              label="On import"
              value={mode}
              onChange={chooseMode}
              options={[
                { value: 'copy', label: 'Copy' },
                { value: 'move', label: 'Move' },
              ]}
            />
          </div>
          {mode === 'move' ? (
            <div className="ovl-import__warning mono-data" role="alert">
              <Icon name="triangle-alert" size={12} />
              Originals will be deleted from the card after import.
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
            label="Copying & encrypting"
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
                  ? 'Import failed — nothing was deleted from the card. Check the source and try again.'
                  : `${[
                      `${formatCount(imported)} imported`,
                      ...(failed > 0 ? [`${formatCount(failed)} failed`] : []),
                      ...(cancelled > 0 ? [`${formatCount(cancelled)} cancelled`] : []),
                    ].join(' · ')} — everything not imported was kept on the card.`}
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
