import { useState, type ReactElement } from 'react';

import './pill.css';
import { useFormats } from '../i18n/use-formats.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { AlbumPicker } from './AlbumPicker';
import type { AlbumSummary } from '../../../shared/library/types.js';
import { destructiveActions } from '../../../shared/destructive-actions.js';

export interface SelectionPillProps {
  readonly count: number;
  readonly onClear: () => void;
  /** Opens the ExportDialog with the selection set (#100). */
  readonly onExport?: (() => void) | undefined;
  readonly onOffload?: (() => void) | undefined;
  readonly onTransfer?: (() => void) | undefined;
  /** Soft-deletes the selection (#120) into reversible Trash custody. */
  readonly onDelete?: (() => void) | undefined;
  /** Inside Trash the pill flips to restore mode (#120). */
  readonly onRestore?: (() => void) | undefined;
  /** Adds the selection to the picked album (#118). */
  readonly onAddToAlbum?: ((album: AlbumSummary) => void) | undefined;
  /** Active-album mode: removes membership without deleting photos (#282). */
  readonly onRemoveFromAlbum?: (() => void) | undefined;
  /** Trash-only destructive path (#121) — opens the confirm ceremony. */
  readonly onPurge?: (() => void) | undefined;
}

// Floating selection pill (#78) — the mock's bottom-center bar. Export
// (#100), Trash/restore/purge (#120/#121), and Add to album (#118) live.
export function SelectionPill({
  count,
  onClear,
  onExport,
  onOffload,
  onTransfer,
  onDelete,
  onRestore,
  onAddToAlbum,
  onRemoveFromAlbum,
  onPurge,
}: SelectionPillProps): ReactElement {
  const { formatCount } = useFormats();
  const actions = destructiveActions;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className="ovl-pill-anchor">
      <div className="ovl-pill" data-testid="selection-pill">
        {pickerOpen && onAddToAlbum !== undefined ? (
          <AlbumPicker
            onPick={(album) => {
              setPickerOpen(false);
              onAddToAlbum(album);
            }}
            onClose={() => {
              setPickerOpen(false);
            }}
          />
        ) : null}
        <span className="ovl-pill__count mono-data">{formatCount(count)} SELECTED</span>
        {onRestore !== undefined ? (
          // Trash mode: restore is the headline; purge is the destructive
          // purge behind #121's confirm ceremony.
          <>
            <Button size="sm" variant="secondary" icon="refresh-cw" onClick={onRestore}>
              {actions.restorePhotosFromTrash.label}
            </Button>
            <Button size="sm" variant="danger" icon="trash-2" onClick={onPurge}>
              {actions.deletePhotosPermanently.label}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" icon="cloud-upload" onClick={onOffload}>
              Offload
            </Button>
            <div className="ovl-pill__wide-actions">
              <Button size="sm" variant="secondary" icon="refresh-cw" onClick={onTransfer}>
                Transfer &amp; Sync
              </Button>
              <Button size="sm" variant="secondary" icon="share" onClick={onExport}>
                Export
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="album"
                onClick={() => {
                  setPickerOpen((open) => !open);
                }}
              >
                Add to album
              </Button>
              {onRemoveFromAlbum === undefined ? (
                <Button size="sm" variant="danger" icon="trash-2" onClick={onDelete}>
                  {actions.movePhotosToTrash.label}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" icon="x" onClick={onRemoveFromAlbum}>
                  {actions.removePhotosFromAlbum.label}
                </Button>
              )}
            </div>
            <div className="ovl-pill__more">
              <IconButton icon="sliders-horizontal" label="More selection actions" size="sm" onClick={() => setMoreOpen((open) => !open)} />
              {moreOpen ? (
                <div className="ovl-pill__menu" role="menu">
                  <button type="button" role="menuitem" onClick={onTransfer}>
                    Transfer &amp; Sync
                  </button>
                  <button type="button" role="menuitem" onClick={onExport}>
                    Export
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      setPickerOpen(true);
                    }}
                  >
                    Add to album
                  </button>
                  {onRemoveFromAlbum === undefined ? (
                    <button type="button" role="menuitem" className="ovl-pill__menuDanger" onClick={onDelete}>
                      {actions.movePhotosToTrash.label}
                    </button>
                  ) : (
                    <button type="button" role="menuitem" onClick={onRemoveFromAlbum}>
                      {actions.removePhotosFromAlbum.label}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </>
        )}
        <IconButton icon="x" label="Clear selection" size="sm" onClick={onClear} />
      </div>
    </div>
  );
}
