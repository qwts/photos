import { useEffect, useState, type ReactElement } from 'react';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Switch } from '../components/Switch';
import { Segmented } from '../components/Segmented';
import { Field } from './Field';
import type { AppSettings } from '../../../shared/settings/settings.js';
import type { KeyDialogMode } from './KeyDialog';
import type { AppPasswordMode } from './AppPasswordDialog';

// Privacy section (#115): honest, factual, mostly locked-on. Face grouping
// ships DISABLED — the mock shows it locked-on, but the feature is deferred
// by design and we don't fake it (conflict recorded on the epic). The
// diagnostics switch persists the preference; no reporting pipeline exists
// yet, and the copy says so.

export interface PrivacyPaneProps {
  readonly settings: AppSettings;
  readonly onPatch: (patch: Partial<Pick<AppSettings, 'shareDiagnostics' | 'appLockIdle' | 'lockWhenHidden'>>) => void;
  /** Opens the KeyDialog (#240) in the given mode. */
  readonly onKeyAction: (mode: KeyDialogMode) => void;
  readonly appLockConfigured: boolean;
  readonly onPasswordAction: (mode: AppPasswordMode) => void;
  readonly onLockNow: () => void;
}

export function PrivacyPane({
  settings,
  onPatch,
  onKeyAction,
  appLockConfigured,
  onPasswordAction,
  onLockNow,
}: PrivacyPaneProps): ReactElement {
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
      <Field
        label="App password"
        hint={appLockConfigured ? 'Required on launch and after every lock.' : 'Withholds decryption authority until you unlock.'}
      >
        {appLockConfigured ? (
          <div className="ovl-settings__keyactions">
            <Button variant="secondary" onClick={() => onPasswordAction('change')}>
              Change…
            </Button>
            <Button variant="ghost" onClick={() => onPasswordAction('remove')}>
              Remove…
            </Button>
          </div>
        ) : (
          <Button variant="secondary" icon="lock" onClick={() => onPasswordAction('set')}>
            Set password…
          </Button>
        )}
      </Field>
      <Field label="Lock now" hint="Immediately seals the library and clears decrypted caches.">
        <Button variant="secondary" icon="lock" disabled={!appLockConfigured} onClick={onLockNow}>
          Lock now
        </Button>
      </Field>
      <Field label="Auto-lock" hint="Lock after trusted keyboard or pointer input has been idle.">
        <Segmented
          label="Auto-lock timeout"
          disabled={!appLockConfigured}
          value={settings.appLockIdle}
          options={[
            { value: '1', label: '1m' },
            { value: '5', label: '5m' },
            { value: '15', label: '15m' },
            { value: '30', label: '30m' },
            { value: 'never', label: 'Never' },
          ]}
          onChange={(appLockIdle) => onPatch({ appLockIdle })}
        />
      </Field>
      <Field label="Lock when hidden" hint="Also lock when the app is hidden or minimized.">
        <Switch
          checked={settings.lockWhenHidden}
          disabled={!appLockConfigured}
          onChange={(lockWhenHidden) => onPatch({ lockWhenHidden })}
        />
      </Field>
      <Field
        label="Unlock with Touch ID"
        hint={appLockConfigured ? 'Native Touch ID support is tracked separately and is not enabled yet.' : 'Set an app password first.'}
      >
        <Switch checked={false} disabled />
      </Field>
      <Field label="End-to-end encryption" hint="Originals and thumbnails are encrypted on this device before leaving it.">
        <Badge tone="green">Always on</Badge>
      </Field>
      <div className="ovl-settings__keyrow" data-testid="recovery-key-row">
        <div>
          <div className="ovl-settings__keytitle">Recovery key</div>
          <div className="ovl-settings__keyhint">
            {appLockConfigured
              ? 'Back up your library key here. Remove the app password before importing a different key; recovery remains available from the lock screen when required.'
              : "Back up your library key to unlock photos on another device. Store it safely — it can't be reset."}
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
            disabled={appLockConfigured}
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
