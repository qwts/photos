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

// Storage & Backup section (#114): the provider connection card + every
// backup knob, disconnected-first — ALL backup controls disable when not
// connected (per design). Connect/Disconnect drives settings.providerId
// (the mock connects instantly; live pCloud arrives with #109). Quota is
// the provider's own answer, not a cached guess.

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

  const refresh = useCallback(() => {
    void window.overlook.backup.providerStatus().then(setStatus);
  }, []);

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
            <div className="ovl-settings__providerMeta">Link a provider to store encrypted originals off-device.</div>
          )}
        </div>
        <Button
          variant={connected ? 'secondary' : 'primary'}
          onClick={() => {
            onPatch({ providerId: connected ? null : (status?.provider ?? 'mock') });
          }}
        >
          {connected ? 'Disconnect' : `Connect ${name}`}
        </Button>
      </div>

      <Field label="Back up new imports automatically" hint="Encrypts and uploads originals after import.">
        <Switch
          checked={settings.autoBackupOnImport}
          disabled={!connected}
          onChange={(autoBackupOnImport) => {
            onPatch({ autoBackupOnImport });
          }}
        />
      </Field>
      <Field label="On import, from card or drive" hint="Move frees space immediately; copy keeps the source untouched.">
        <Segmented
          label="On import, from card or drive"
          value={settings.importMode}
          disabled={!connected}
          options={[
            { value: 'copy', label: 'Copy' },
            { value: 'move', label: 'Move' },
          ]}
          onChange={(importMode) => {
            onPatch({ importMode });
          }}
        />
      </Field>
      <Field label="Wi-Fi only" hint="Pause uploads on cellular or metered connections.">
        <Switch
          checked={settings.wifiOnly}
          disabled={!connected}
          onChange={(wifiOnly) => {
            onPatch({ wifiOnly });
          }}
        />
      </Field>
      <Field label="Upload bandwidth limit" hint={bandwidth >= 100 ? 'Unlimited' : `${String(bandwidth)}% of available upload`}>
        <div className={connected ? undefined : 'ovl-settings__lockedControl'}>
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
        </div>
      </Field>
      <Field label="Encrypt originals" hint="Client-side encryption before any upload. Cannot be disabled.">
        <Switch checked disabled />
      </Field>
    </div>
  );
}
