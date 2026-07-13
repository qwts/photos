import { useEffect, useState, type ReactElement } from 'react';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Switch } from '../components/Switch';
import { Field } from './Field';
import type { AppSettings } from '../../../shared/settings/settings.js';
import type { KeyDialogMode } from './KeyDialog';

// Privacy section (#115): honest, factual, mostly locked-on. Face grouping
// ships DISABLED — the mock shows it locked-on, but the feature is deferred
// by design and we don't fake it (conflict recorded on the epic). The
// diagnostics switch persists the preference; no reporting pipeline exists
// yet, and the copy says so.

export interface PrivacyPaneProps {
  readonly settings: AppSettings;
  readonly onPatch: (patch: Partial<Pick<AppSettings, 'shareDiagnostics'>>) => void;
  /** Opens the KeyDialog (#240) in the given mode. */
  readonly onKeyAction: (mode: KeyDialogMode) => void;
}

export function PrivacyPane({ settings, onPatch, onKeyAction }: PrivacyPaneProps): ReactElement {
  // The recovery row's fingerprint (#240) — the same identifier the
  // KeyDialog shows; '—' while the keystore is unavailable.
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  useEffect(() => {
    void window.overlook.keys
      .status()
      .then(({ fingerprint: value }) => {
        setFingerprint(value);
      })
      .catch(() => {
        setFingerprint(null);
      });
  }, []);
  return (
    <div className="ovl-settings__fields">
      <Field label="End-to-end encryption" hint="Originals and thumbnails are encrypted on this device before leaving it.">
        <Badge tone="green">Always on</Badge>
      </Field>
      <div className="ovl-settings__keyrow" data-testid="recovery-key-row">
        <div>
          <div className="ovl-settings__keytitle">Recovery key</div>
          <div className="ovl-settings__keyhint">
            Back up your library key to unlock photos on another device. Store it safely — it can't be reset.
          </div>
          <div className="ovl-settings__keyfp">
            <Icon name="fingerprint" size={13} color="var(--text-faint)" />
            <span className="mono-data">{fingerprint ?? '—'}</span>
          </div>
        </div>
        <div className="ovl-settings__keyactions">
          <Button
            variant="secondary"
            icon="download"
            onClick={() => {
              onKeyAction('backup');
            }}
          >
            Back up…
          </Button>
          <Button
            variant="ghost"
            icon="upload"
            onClick={() => {
              onKeyAction('import');
            }}
          >
            Import…
          </Button>
        </div>
      </div>
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
