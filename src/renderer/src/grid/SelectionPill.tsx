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
}

// Floating selection pill (#78) — the mock's bottom-center bar. Export is
// live (#100); the remaining bulk actions render disabled with their epic
// named in the tooltip until they land (Add to album → M10, Delete → M10's
// soft-delete).
export function SelectionPill({ count, onClear, onExport }: SelectionPillProps): ReactElement {
  return (
    <div className="ovl-pill-anchor">
      <div className="ovl-pill" data-testid="selection-pill">
        <span className="ovl-pill__count mono-data">{formatCount(count)} SELECTED</span>
        <Button size="sm" variant="secondary" icon="share" onClick={onExport}>
          Export
        </Button>
        <Button size="sm" variant="secondary" icon="album" disabled title="Albums land with M10">
          Add to album
        </Button>
        <Button size="sm" variant="danger" icon="trash-2" disabled title="Delete lands with M07">
          Delete
        </Button>
        <IconButton icon="x" label="Clear selection" size="sm" onClick={onClear} />
      </div>
    </div>
  );
}
