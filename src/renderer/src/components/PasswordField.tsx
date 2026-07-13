import { useState, type ReactElement } from 'react';

import { Icon } from './Icon';

import './controls.css';

// components/… KeyDialog.jsx's PasswordField (#240): lock glyph, wide
// tracking while masked, mono when revealed, reveal toggle mirrored for
// keyboard users. JS-driven focus ring like the other inputs.

export interface PasswordFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
}

export function PasswordField({ value, onChange, label, placeholder, autoFocus = false }: PasswordFieldProps): ReactElement {
  const [focus, setFocus] = useState(false);
  const [reveal, setReveal] = useState(false);
  return (
    <div className={`ovl-password${focus ? ' ovl-password--focus' : ''}`}>
      <Icon name="lock" size={14} color={focus ? 'var(--text-body)' : 'var(--text-faint)'} />
      <input
        className={`ovl-password__input${reveal ? ' ovl-password__input--reveal' : ''}`}
        type={reveal ? 'text' : 'password'}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        // The dialog opened straight into this field — take focus so typing
        // works immediately (mock behavior).
        autoFocus={autoFocus}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onFocus={() => {
          setFocus(true);
        }}
        onBlur={() => {
          setFocus(false);
        }}
      />
      <button
        type="button"
        className="ovl-password__reveal"
        aria-label={reveal ? 'Hide password' : 'Show password'}
        onClick={() => {
          setReveal((current) => !current);
        }}
      >
        <Icon name={reveal ? 'eye-off' : 'eye'} size={14} />
      </button>
    </div>
  );
}
