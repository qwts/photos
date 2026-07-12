import type { ReactElement } from 'react';

import './inputs.css';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange?: (checked: boolean) => void;
  /** The "always on, cannot be disabled" pattern renders checked+disabled. */
  readonly disabled?: boolean;
  readonly label?: string;
}

// components/forms/Switch.jsx with real switch semantics (#61 exit criteria):
// a button with role=switch — keyboard operable, announced correctly.
export function Switch({ checked, onChange, disabled = false, label }: SwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="ovl-switch"
      onClick={() => {
        onChange?.(!checked);
      }}
    >
      <span className="ovl-switch__track">
        <span className="ovl-switch__knob" />
      </span>
      {label === undefined ? null : <span>{label}</span>}
    </button>
  );
}
