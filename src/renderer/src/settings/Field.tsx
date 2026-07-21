import { useId, type ReactElement, type ReactNode } from 'react';

import './settings.css';

export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

// The settings panes' row primitive per the design's Field: label (+ muted
// hint) left, control right, hairline below. Shared by #113–#115.
export function Field({ label, hint, children }: FieldProps): ReactElement {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="ovl-settings__field">
      <div>
        <div id={labelId} className="ovl-settings__fieldLabel">
          {label}
        </div>
        {hint === undefined ? null : (
          <div id={hintId} className="ovl-settings__fieldHint">
            {hint}
          </div>
        )}
      </div>
      <div
        className="ovl-settings__fieldControl"
        role="group"
        aria-labelledby={labelId}
        aria-describedby={hint === undefined ? undefined : hintId}
      >
        {children}
      </div>
    </div>
  );
}
