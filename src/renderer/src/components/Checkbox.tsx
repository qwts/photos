import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

import './inputs.css';
import { Icon } from './Icon';

export interface CheckboxProps {
  readonly checked: boolean;
  readonly indeterminate?: boolean;
  readonly onChange?: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly label: string;
}

// components/forms/Checkbox.jsx over a real hidden input (#61 exit criteria):
// keyboard operable, indeterminate reported as aria-checked=mixed.
export function Checkbox({ checked, indeterminate = false, onChange, disabled = false, label }: CheckboxProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current !== null) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  const on = checked || indeterminate;
  return (
    <label className={`ovl-checkbox${disabled ? ' ovl-checkbox--disabled' : ''}`}>
      <input
        ref={inputRef}
        type="checkbox"
        className="ovl-checkbox__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          // Browsers clear the DOM indeterminate flag on activation; keep it
          // in sync with the prop so mixed state survives until the parent
          // decides the next state (PR #144 review).
          event.target.indeterminate = indeterminate;
          onChange?.(event.target.checked);
        }}
      />
      <span className={`ovl-checkbox__box${on ? ' ovl-checkbox__box--on' : ''}`}>
        {indeterminate ? <Icon name="minus" size={11} strokeWidth={3} /> : checked ? <Icon name="check" size={11} strokeWidth={3} /> : null}
      </span>
      <span>{label}</span>
    </label>
  );
}
