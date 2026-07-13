import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { formatBytes } from '../../../shared/library/format.js';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';
import { Segmented } from '../components/Segmented';
import { Slider } from '../components/Slider';
import { Switch } from '../components/Switch';
import { Field } from './Field';
import type { AppSettings } from '../../../shared/settings/settings.js';

// Storage & Backup section (#114, updated by #239, #254): the provider
// connection card + backup knobs. Disconnected now HIDES the backup-specific
// controls (auto-backup, Wi-Fi only, bandwidth) instead of disabling them —
// only the connection card, import Copy/Move (which needs no provider), and
// the locked Encrypt switch remain, per the updated design.
// Connect/Disconnect goes through backup:connect / backup:disconnect (#254)
// so main owns the handshake — instant for the mock, the OAuth browser
// round-trip for pCloud; providerId flips in settings either way and the
// settings-changed push re-renders this pane. Quota is the provider's own
// answer, not a cached guess.

export interface ProviderStatus {
  readonly provider: 'mock' | 'pcloud';
  readonly connected: boolean;
  readonly account: string | null;
  readonly usedBytes: number;
  readonly totalBytes: number;
}

const PROVIDER_NAMES = { mock: 'Mock provider', pcloud: 'pCloud' } as const;

export interface StoragePaneProps {
  readonly settings: AppSettings;
  readonly onPatch: (
    patch: Partial<Pick<AppSettings, 'autoBackupOnImport' | 'importMode' | 'wifiOnly' | 'bandwidthLimit' | 'providerId'>>,
  ) => void;
}

export function StoragePane({ settings, onPatch }: StoragePaneProps): ReactElement {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.overlook.backup.providerStatus().then(setStatus);
  }, []);

  const toggleConnection = useCallback(
    (isConnected: boolean) => {
      setConnecting(true);
      setConnectError(null);
      void (isConnected ? window.overlook.backup.disconnect() : window.overlook.backup.connect())
        .then((result) => {
          if ('reason' in result && !result.ok) {
            setConnectError(result.reason ?? 'Connection failed.');
          }
        })
        .finally(() => {
          setConnecting(false);
          refresh();
        });
    },
    [refresh],
  );

  // providerId is part of `settings`, so a connect/disconnect patch
  // re-renders this pane and the effect refetches the card's truth.
  useEffect(() => {
    refresh();
  }, [refresh, settings.providerId]);

  const connected = settings.providerId !== null && status?.connected === true;
  const name = PROVIDER_NAMES[status?.provider ?? 'mock'];
  const bandwidth = settings.bandwidthLimit;

  return (
    <div className="ovl-settings__fields">
      <div className="ovl-settings__provider" data-testid="provider-card">
        <Icon name="cloud" size={20} color={connected ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
        <div className="ovl-settings__providerBody">
          <div className="ovl-settings__providerHead">
            <span className="ovl-settings__providerName">{name}</span>
            {connected ? <Badge tone="green">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
          </div>
          {connected && status !== null ? (
            <>
              <div className="ovl-settings__providerMeta mono-data">
                {status.account ?? 'THIS DEVICE'} · {formatBytes(status.usedBytes).toUpperCase()} /{' '}
                {formatBytes(status.totalBytes).toUpperCase()} USED
              </div>
              <ProgressBar value={status.usedBytes} max={Math.max(status.totalBytes, 1)} tone="cyan" />
            </>
          ) : (
            <div className="ovl-settings__providerMeta">
              {connectError === null ? 'Link a provider to store encrypted originals off-device.' : connectError}
            </div>
          )}
        </div>
        <Button
          variant={connected ? 'secondary' : 'primary'}
          disabled={connecting}
          onClick={() => {
            toggleConnection(connected);
          }}
        >
          {connecting ? 'Connecting…' : connected ? 'Disconnect' : `Connect ${name}`}
        </Button>
      </div>

      {connected ? (
        <>
          <Field label="Back up new imports automatically" hint="Encrypts and uploads originals after import.">
            <Switch
              checked={settings.autoBackupOnImport}
              onChange={(autoBackupOnImport) => {
                onPatch({ autoBackupOnImport });
              }}
            />
          </Field>
          <Field label="Wi-Fi only" hint="Pause uploads on cellular or metered connections.">
            <Switch
              checked={settings.wifiOnly}
              onChange={(wifiOnly) => {
                onPatch({ wifiOnly });
              }}
            />
          </Field>
          <Field label="Upload bandwidth limit" hint={bandwidth >= 100 ? 'Unlimited' : `${String(bandwidth)}% of available upload`}>
            <Slider
              label="Upload bandwidth limit"
              value={bandwidth}
              min={10}
              max={100}
              step={5}
              width={130}
              onChange={(bandwidthLimit) => {
                onPatch({ bandwidthLimit });
              }}
            />
          </Field>
        </>
      ) : null}
      <Field label="On import, from card or drive" hint="Move frees space immediately; copy keeps the source untouched.">
        <Segmented
          label="On import, from card or drive"
          value={settings.importMode}
          options={[
            { value: 'copy', label: 'Copy' },
            { value: 'move', label: 'Move' },
          ]}
          onChange={(importMode) => {
            onPatch({ importMode });
          }}
        />
      </Field>
      <Field label="Encrypt originals" hint="Client-side encryption before any upload. Cannot be disabled.">
        <Switch checked disabled />
      </Field>
    </div>
  );
}
