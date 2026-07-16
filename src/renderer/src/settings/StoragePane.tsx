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
import { OffloadedStorage } from './OffloadedStorage';
import type { AppSettings } from '../../../shared/settings/settings.js';
import type { ProviderDescriptor } from '../../../shared/backup/provider-descriptor.js';

// Storage & Backup section (#114, updated by #239, #254): the provider
// connection card + backup knobs. Disconnected now HIDES the backup-specific
// controls (auto-backup, Wi-Fi only, bandwidth) instead of disabling them —
// only the connection card, import Copy/Move (which needs no provider), and
// the locked Encrypt switch remain, per the updated design.
// Connect/Disconnect goes through backup:connect / backup:disconnect (#254)
// so main owns the handshake — instant for the mock, the OAuth browser
// round-trip for interactive providers; providerId flips in settings and the
// settings-changed push re-renders this pane. Quota is the provider's own
// answer, not a cached guess.

export interface ProviderStatus {
  readonly provider: ProviderDescriptor;
  readonly connected: boolean;
  readonly account: string | null;
  readonly usedBytes: number | null;
  readonly totalBytes: number | null;
}

export interface StoragePaneProps {
  readonly settings: AppSettings;
  readonly selectedPhotoIds: readonly string[];
  readonly onRestore?: (() => void) | undefined;
  readonly onPatch: (
    patch: Partial<
      Pick<AppSettings, 'autoBackupOnImport' | 'reOffloadAfterViewing' | 'importMode' | 'wifiOnly' | 'bandwidthLimit' | 'providerId'>
    >,
  ) => void;
}

export function StoragePane({ settings, selectedPhotoIds, onPatch, onRestore }: StoragePaneProps): ReactElement {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [providers, setProviders] = useState<readonly ProviderDescriptor[]>([]);
  const [targetId, setTargetId] = useState<string | null>(settings.providerId);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (targetId !== null) {
      void window.overlook.backup.providerStatus({ providerId: targetId }).then(setStatus);
    }
  }, [targetId]);

  const toggleConnection = useCallback(
    (isConnected: boolean) => {
      setConnecting(true);
      setConnectError(null);
      if (targetId === null) {
        setConnecting(false);
        return;
      }
      void (
        isConnected ? window.overlook.backup.disconnect({ providerId: targetId }) : window.overlook.backup.connect({ providerId: targetId })
      )
        .then((result) => {
          if (!result.ok) {
            setConnectError(result.reason ?? 'Connection failed.');
          }
        })
        .finally(() => {
          setConnecting(false);
          refresh();
        });
    },
    [refresh, targetId],
  );

  // providerId is part of `settings`, so a connect/disconnect patch
  // re-renders this pane and the effect refetches the card's truth.
  useEffect(() => {
    void window.overlook.backup.providers().then(({ providers: loaded, defaultProviderId }) => {
      setProviders(loaded);
      setTargetId((current) => {
        const selected = loaded.some((provider) => provider.id === settings.providerId) ? settings.providerId : null;
        const retained = loaded.some((provider) => provider.id === current) ? current : null;
        return selected ?? retained ?? defaultProviderId;
      });
    });
  }, [settings.providerId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const descriptor = providers.find((provider) => provider.id === targetId) ?? status?.provider ?? null;
  const connected = settings.providerId === targetId && status?.connected === true;
  const name = descriptor?.label ?? 'Cloud provider';
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
          {connected && status !== null && status.usedBytes !== null && status.totalBytes !== null ? (
            <>
              <div className="ovl-settings__providerMeta mono-data">
                {status.account ?? 'THIS DEVICE'} · {formatBytes(status.usedBytes).toUpperCase()} /{' '}
                {formatBytes(status.totalBytes).toUpperCase()} USED
              </div>
              <ProgressBar value={status.usedBytes} max={Math.max(status.totalBytes, 1)} tone="cyan" />
            </>
          ) : connected ? (
            <div className="ovl-settings__providerMeta mono-data">{status?.account ?? 'THIS DEVICE'} · STORAGE USAGE NOT REPORTED</div>
          ) : (
            <div className="ovl-settings__providerMeta">
              {connectError === null ? 'Link a provider to store encrypted originals off-device.' : connectError}
            </div>
          )}
          {descriptor === null ? null : (
            <div className="ovl-settings__providerMeta mono-data">
              {descriptor.capabilities.verification === 'server-checksum' ? 'SERVER CHECKSUM' : 'VERIFY BY DOWNLOAD'} ·{' '}
              {descriptor.capabilities.resumableUpload ? 'RESUMABLE UPLOADS' : 'RESTARTS INTERRUPTED UPLOADS'}
            </div>
          )}
          {connectError === null || !connected ? null : <div className="ovl-settings__providerMeta">{connectError}</div>}
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

      {!connected && providers.length > 1 && targetId !== null ? (
        <Field label="Backup provider" hint="Choose where encrypted library data is stored.">
          <Segmented
            label="Backup provider"
            value={targetId}
            options={providers.map((provider) => ({ value: provider.id, label: provider.label, disabled: !provider.available }))}
            onChange={(providerId) => {
              setTargetId(providerId);
              setStatus(null);
              setConnectError(null);
            }}
          />
        </Field>
      ) : null}

      <Field label="Restore from cloud backup" hint="Recover a complete library with its separately saved recovery key.">
        <Button icon="cloud-download" onClick={onRestore}>
          Restore library…
        </Button>
      </Field>

      <OffloadedStorage connected={connected} selectedPhotoIds={selectedPhotoIds} />

      <Field label="Re-offload after viewing" hint="Keep cloud-only originals temporary unless you choose Keep downloaded.">
        <Switch
          checked={settings.reOffloadAfterViewing}
          onChange={(reOffloadAfterViewing) => {
            onPatch({ reOffloadAfterViewing });
          }}
        />
      </Field>

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
