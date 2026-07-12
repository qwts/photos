import type { ReactElement } from 'react';

import './pill.css';
import { formatCount } from '../../../shared/library/format.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';

export interface SelectionPillProps {
  readonly count: number;
  readonly onClear: () => void;
}

// Floating selection pill (#78) — the mock's bottom-center bar. The bulk
// actions are stubbed until their epics land (Export → M07, Add to album →
// M10, Delete → M07's trash flow); they render disabled with the epic named
// in the tooltip so the entry points are already in place.
export function SelectionPill({ count, onClear }: SelectionPillProps): ReactElement {
  return (
    <div className="ovl-pill-anchor">
      <div className="ovl-pill" data-testid="selection-pill">
        <span className="ovl-pill__count mono-data">{formatCount(count)} SELECTED</span>
        <Button size="sm" variant="secondary" icon="share" disabled title="Export lands with M07">
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
