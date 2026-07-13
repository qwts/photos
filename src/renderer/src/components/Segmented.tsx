import { useRef } from 'react';
import type { ReactElement } from 'react';

import './forms.css';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
  /** Icon-only rendering; the label becomes the Tooltip + accessible name. */
  readonly iconOnly?: boolean;
  /** Unavailable option (#113's locked-control pattern): rendered but not
   * selectable — the button disables and arrow keys skip it. */
  readonly disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  readonly options: readonly (T | SegmentedOption<T>)[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Accessible name for the group (e.g. "View", "On import"). */
  readonly label: string;
}

function normalize<T extends string>(option: T | SegmentedOption<T>): SegmentedOption<T> {
  return typeof option === 'string' ? { value: option, label: option } : option;
}

// components/forms/Segmented.jsx + keyboard operation per #60's exit
// criteria: radiogroup semantics, arrow keys move the exclusive selection.
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>): ReactElement {
  const groupRef = useRef<HTMLDivElement>(null);
  const normalized = options.map(normalize);

  const moveSelection = (delta: number): void => {
    const enabled = normalized.filter((option) => option.disabled !== true);
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (next !== undefined) {
      onChange(next.value);
      groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
    }
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className="ovl-segmented"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(-1);
        }
      }}
    >
      {normalized.map((option) => {
        const on = option.value === value;
        const iconOnly = option.iconOnly === true && option.icon !== undefined;
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.label}
            data-value={option.value}
            disabled={option.disabled}
            tabIndex={on ? 0 : -1}
            className={[
              'ovl-segmented__option',
              iconOnly ? 'ovl-segmented__option--icon-only' : undefined,
              on ? 'ovl-segmented__option--on' : undefined,
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.icon === undefined ? null : <Icon name={option.icon} size={14} />}
            {iconOnly ? null : option.label}
          </button>
        );
        return iconOnly ? (
          <Tooltip key={option.value} label={option.label}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
