import type { ReactElement } from 'react';

import { Badge } from '../components/Badge';
import { Switch } from '../components/Switch';
import { Field } from './Field';
import type { AppSettings } from '../../../shared/settings/settings.js';

// Privacy section (#115): honest, factual, mostly locked-on. Face grouping
// ships DISABLED — the mock shows it locked-on, but the feature is deferred
// by design and we don't fake it (conflict recorded on the epic). The
// diagnostics switch persists the preference; no reporting pipeline exists
// yet, and the copy says so.

export interface PrivacyPaneProps {
  readonly settings: AppSettings;
  readonly onPatch: (patch: Partial<Pick<AppSettings, 'shareDiagnostics'>>) => void;
}

export function PrivacyPane({ settings, onPatch }: PrivacyPaneProps): ReactElement {
  return (
    <div className="ovl-settings__fields">
      <Field label="End-to-end encryption" hint="Originals and thumbnails are encrypted on this device before leaving it.">
        <Badge tone="green">Always on</Badge>
      </Field>
      <Field label="Face grouping" hint="Not yet available — will run entirely on-device when it ships.">
        <Switch checked={false} disabled />
      </Field>
      <Field
        label="Share diagnostics"
        hint="Anonymous crash reports only — never photo content or metadata. Reporting stays local-only for now."
      >
        <Switch
          checked={settings.shareDiagnostics}
          onChange={(shareDiagnostics) => {
            onPatch({ shareDiagnostics });
          }}
        />
      </Field>
    </div>
  );
}
