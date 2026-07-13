import { useState, type ReactElement } from 'react';

import './pill.css';
import { formatCount } from '../../../shared/library/format.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { AlbumPicker } from './AlbumPicker';
import type { AlbumSummary } from '../../../shared/library/types.js';

export interface SelectionPillProps {
  readonly count: number;
  readonly onClear: () => void;
  /** Opens the ExportDialog with the selection set (#100). */
  readonly onExport?: (() => void) | undefined;
  /** Soft-deletes the selection (#120) — "Delete" per the language rules
   * because the photos leave the library view (restorable in trash). */
  readonly onDelete?: (() => void) | undefined;
  /** Inside Recently deleted the pill flips to restore mode (#120). */
  readonly onRestore?: (() => void) | undefined;
  /** Adds the selection to the picked album (#118). */
  readonly onAddToAlbum?: ((album: AlbumSummary) => void) | undefined;
  /** Trash-only destructive path (#121) — opens the confirm ceremony. */
  readonly onPurge?: (() => void) | undefined;
}

// Floating selection pill (#78) — the mock's bottom-center bar. Export
// (#100), Delete/Restore/purge (#120/#121), and Add to album (#118) live.
export function SelectionPill({
  count,
  onClear,
  onExport,
  onDelete,
  onRestore,
  onAddToAlbum,
  onPurge,
}: SelectionPillProps): ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);
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
          // Trash mode: Restore is the headline; Delete is the destructive
          // purge behind #121's confirm ceremony.
          <>
            <Button size="sm" variant="secondary" icon="refresh-cw" onClick={onRestore}>
              Restore
            </Button>
            <Button size="sm" variant="danger" icon="trash-2" onClick={onPurge}>
              Delete
            </Button>
          </>
        ) : (
          <>
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
            <Button size="sm" variant="danger" icon="trash-2" onClick={onDelete}>
              Delete
            </Button>
          </>
        )}
        <IconButton icon="x" label="Clear selection" size="sm" onClick={onClear} />
      </div>
    </div>
  );
}
