import type { ReactElement } from 'react';

import './inputs.css';

interface SwitchBaseProps {
  readonly checked: boolean;
  readonly onChange?: (checked: boolean) => void;
  /** The "always on, cannot be disabled" pattern renders checked+disabled. */
  readonly disabled?: boolean;
}

export type SwitchProps = SwitchBaseProps &
  ({ readonly label: string; readonly accessibleLabel?: never } | { readonly label?: never; readonly accessibleLabel: string });

// components/forms/Switch.jsx with real switch semantics (#61 exit criteria):
// a button with role=switch — keyboard operable, announced correctly.
export function Switch({ checked, onChange, disabled = false, label, accessibleLabel }: SwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={accessibleLabel}
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
