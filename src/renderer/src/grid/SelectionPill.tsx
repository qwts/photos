import type { ReactElement } from 'react';

import './pill.css';
import { formatCount } from '../../../shared/library/format.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';

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
}

// Floating selection pill (#78) — the mock's bottom-center bar. Export
// (#100) and Delete/Restore (#120) are live; Add to album lands with #118.
export function SelectionPill({ count, onClear, onExport, onDelete, onRestore }: SelectionPillProps): ReactElement {
  return (
    <div className="ovl-pill-anchor">
      <div className="ovl-pill" data-testid="selection-pill">
        <span className="ovl-pill__count mono-data">{formatCount(count)} SELECTED</span>
        {onRestore !== undefined ? (
          // Trash mode: restoring is the headline action; the destructive
          // purge path arrives with #121's confirm ceremony.
          <Button size="sm" variant="secondary" icon="refresh-cw" onClick={onRestore}>
            Restore
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" icon="share" onClick={onExport}>
              Export
            </Button>
            <Button size="sm" variant="secondary" icon="album" disabled title="Add to album lands with #118">
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
