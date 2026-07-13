import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { ZOOM_MAX, ZOOM_MIN } from '../../../shared/library/app-state.js';
import type { ChipFilters } from '../../../shared/library/types.js';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { IconButton } from '../components/IconButton';
import { SearchField } from '../components/SearchField';
import { Segmented } from '../components/Segmented';
import { Slider } from '../components/Slider';
import { Tooltip } from '../components/Tooltip';
import { useAppState, useAppDispatch } from '../state/app-state-context';

const QUERY_DEBOUNCE_MS = 250;

const FILTERS: readonly { key: keyof ChipFilters; icon: 'star' | 'image' | 'cloud' | 'hard-drive'; label: string }[] = [
  { key: 'favorites', icon: 'star', label: 'Favorites' },
  { key: 'raw', icon: 'image', label: 'RAW' },
  { key: 'offloaded', icon: 'cloud', label: 'Offloaded' },
  { key: 'localOnly', icon: 'hard-drive', label: 'Local only' },
];

// The 48px command strip (#79) per the design's Toolbar.jsx: wordmark,
// debounced search, funnel + chip row, view segmented, zoom (hidden in list
// via visibility so layout holds), backup state from pendingCount pushes,
// and the primary Import entry point (#88 dialog via onImport). Backup
// lands with M08 — until then it surfaces its stub toast.
export interface ToolbarProps {
  /** Opens the ImportDialog (#88); wired by the shell. */
  readonly onImport?: (() => void) | undefined;
}

export function Toolbar({ onImport }: ToolbarProps = {}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState(state.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
    };
  }, []);

  const onSearch = (value: string): void => {
    setDraft(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatch({ type: 'query/set', query: value });
    }, QUERY_DEBOUNCE_MS);
  };

  const anyFilter = Object.values(state.chips).some(Boolean);
  return (
    <div className="ovl-toolbar titlebar-no-drag">
      <div className="ovl-toolbar__row">
        <div className="ovl-toolbar__wordmark">
          <Icon name="aperture" size={18} color="var(--accent-cyan)" />
          <span className="ovl-toolbar__brand">OVERLOOK</span>
        </div>
        <SearchField value={draft} onChange={onSearch} width={300} label="Search library" />
        <IconButton
          icon="funnel"
          label="Filters"
          active={filterOpen || anyFilter}
          onClick={() => {
            setFilterOpen((open) => !open);
          }}
        />
        <div className="ovl-toolbar__spacer" />
        <Segmented
          label="View"
          options={[
            { value: 'grid', label: 'Grid', icon: 'layout-grid', iconOnly: true },
            { value: 'list', label: 'List', icon: 'list', iconOnly: true },
          ]}
          value={state.view}
          onChange={(view) => {
            dispatch({ type: 'view/set', view });
          }}
        />
        <div className="ovl-toolbar__zoom" style={{ visibility: state.view === 'list' ? 'hidden' : 'visible' }}>
          <Icon name="grid-3x3" size={13} color="var(--text-faint)" />
          <Slider
            label="Zoom"
            value={state.zoom}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            width={110}
            onChange={(zoom) => {
              dispatch({ type: 'zoom/set', zoom });
            }}
          />
          <Icon name="grid-2x2" size={15} color="var(--text-faint)" />
        </div>
        <Tooltip label={state.pendingCount > 0 ? 'Back up now' : 'All photos backed up'} side="bottom">
          <IconButton
            icon="cloud-upload"
            label="Back up"
            disabled={state.pendingCount === 0}
            onClick={() => {
              // Manual trigger (#108): amber start toast per the mock; the
              // completion listener shows green/red endings. A disconnected
              // provider blocks the run (#114) — say so instead.
              dispatch({ type: 'toast/shown', toast: { title: 'BACKUP STARTED', tone: 'amber' } });
              void window.overlook.backup.run({}).then(({ skipped }) => {
                if (skipped === 'disconnected') {
                  dispatch({ type: 'toast/shown', toast: { title: 'BACKUP OFF — NOT CONNECTED', tone: 'neutral' } });
                }
              });
            }}
          />
        </Tooltip>
        <Button
          variant="primary"
          icon="download"
          size="md"
          onClick={() => {
            onImport?.();
          }}
        >
          Import
        </Button>
      </div>
      {filterOpen ? (
        <div className="ovl-toolbar__chips" data-testid="chip-row">
          {FILTERS.map(({ key, icon, label }) => (
            <Chip
              key={key}
              icon={icon}
              selected={state.chips[key] === true}
              onClick={() => {
                dispatch({ type: 'chip/toggled', chip: key });
              }}
            >
              {label}
            </Chip>
          ))}
          <span className="ovl-toolbar__hint mono-data">SEMANTIC SEARCH — COMING SOON</span>
        </div>
      ) : null}
    </div>
  );
}
