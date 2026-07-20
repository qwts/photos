import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { useFormats } from '../i18n/use-formats.js';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
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

type ProviderStatusLoad =
  | { readonly targetId: string; readonly state: 'ready'; readonly value: ProviderStatus }
  | { readonly targetId: string; readonly state: 'error' };

type ConnectionOperation = 'connect' | 'disconnect';

const messages = defineMessages({
  disconnectFailed: {
    id: 'settings.storage.disconnect.failed',
    defaultMessage: 'Disconnect failed. Check status and try again.',
  },
  connectFailed: { id: 'settings.storage.connect.failed', defaultMessage: 'Connection failed. Try again.' },
  disconnecting: { id: 'settings.storage.disconnect.progress', defaultMessage: 'Disconnecting…' },
  removingAuthorization: {
    id: 'settings.storage.disconnect.removing',
    defaultMessage: 'Removing this device’s saved authorization…',
  },
  disconnectTitle: { id: 'settings.storage.disconnect.title', defaultMessage: 'Disconnect {name}?' },
  cancel: { id: 'settings.storage.disconnect.cancel', defaultMessage: 'Cancel' },
  disconnectProvider: { id: 'settings.storage.disconnect.action', defaultMessage: 'Disconnect {name}' },
  disconnectCopy: {
    id: 'settings.storage.disconnect.copy',
    defaultMessage: 'This removes this device’s saved {name} authorization.',
  },
  disconnectReassurance: {
    id: 'settings.storage.disconnect.reassurance',
    defaultMessage: 'Encrypted data already stored in {name} is not deleted.',
  },
});

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
  const intl = useIntl();
  const { formatBytes } = useFormats();
  const [statusLoad, setStatusLoad] = useState<ProviderStatusLoad | null>(null);
  const [providers, setProviders] = useState<readonly ProviderDescriptor[]>([]);
  const [targetId, setTargetId] = useState<string | null>(settings.providerId);
  const [connectionOperation, setConnectionOperation] = useState<ConnectionOperation | null>(null);
  const [disconnectConfirmation, setDisconnectConfirmation] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const statusRequestRef = useRef(0);
  const operationRef = useRef<ConnectionOperation | null>(null);

  const refresh = useCallback(() => {
    const request = statusRequestRef.current + 1;
    statusRequestRef.current = request;
    if (targetId === null) {
      return;
    }
    void window.overlook.backup
      .providerStatus({ providerId: targetId })
      .then((loaded) => {
        if (statusRequestRef.current === request) setStatusLoad({ targetId, state: 'ready', value: loaded });
      })
      .catch(() => {
        if (statusRequestRef.current === request) setStatusLoad({ targetId, state: 'error' });
      });
  }, [targetId]);

  const changeConnection = useCallback(
    (operation: ConnectionOperation) => {
      if (operationRef.current !== null || targetId === null) return;
      operationRef.current = operation;
      setConnectionOperation(operation);
      setConnectError(null);
      setStatusLoad(null);
      statusRequestRef.current += 1;
      const request =
        operation === 'disconnect'
          ? window.overlook.backup.disconnect({ providerId: targetId })
          : window.overlook.backup.connect({ providerId: targetId });
      void request
        .then((result) => {
          if (!result.ok) {
            setConnectError(result.reason ?? 'Connection failed.');
            setStatusLoad({ targetId, state: 'error' });
            return;
          }
          if (operation === 'disconnect') setDisconnectConfirmation(false);
          refresh();
        })
        .catch(() => {
          setConnectError(intl.formatMessage(operation === 'disconnect' ? messages.disconnectFailed : messages.connectFailed));
          setStatusLoad({ targetId, state: 'error' });
        })
        .finally(() => {
          operationRef.current = null;
          setConnectionOperation(null);
        });
    },
    [intl, refresh, targetId],
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

  const status = statusLoad?.targetId === targetId && statusLoad.state === 'ready' ? statusLoad.value : null;
  const descriptor = providers.find((provider) => provider.id === targetId) ?? status?.provider ?? null;
  const connection =
    statusLoad?.targetId === targetId && statusLoad.state === 'error'
      ? 'error'
      : status === null
        ? 'loading'
        : settings.providerId === targetId && status.connected
          ? 'connected'
          : 'disconnected';
  const connected = connection === 'connected';
  const name = descriptor?.label ?? 'Cloud provider';
  const bandwidth = settings.bandwidthLimit;
  const disconnecting = connectionOperation === 'disconnect';
  const connecting = connectionOperation === 'connect';

  return (
    <div className="ovl-settings__fields">
      <div className="ovl-settings__provider" data-testid="provider-card">
        <Icon name="cloud" size={20} color={connected ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
        <div className="ovl-settings__providerBody">
          <div className="ovl-settings__providerHead">
            <span className="ovl-settings__providerName">{name}</span>
            {disconnecting ? (
              <Badge tone="neutral">{intl.formatMessage(messages.disconnecting)}</Badge>
            ) : connection === 'loading' ? (
              <Badge tone="neutral">Checking…</Badge>
            ) : connected ? (
              <Badge tone="green">Connected</Badge>
            ) : connection === 'error' ? (
              <Badge tone="neutral">Status unavailable</Badge>
            ) : (
              <Badge tone="neutral">Not connected</Badge>
            )}
          </div>
          {disconnecting ? (
            <div className="ovl-settings__providerMeta">{intl.formatMessage(messages.removingAuthorization)}</div>
          ) : connection === 'loading' ? (
            <div className="ovl-settings__providerMeta">Checking connection…</div>
          ) : connection === 'error' ? (
            <div className="ovl-settings__providerMeta">Could not check this provider’s connection.</div>
          ) : connected && status !== null && status.usedBytes !== null && status.totalBytes !== null ? (
            <>
              <div className="ovl-settings__providerMeta mono-data">
                {status.account ?? 'THIS DEVICE'} · {formatBytes(status.usedBytes)} / {formatBytes(status.totalBytes)} USED
              </div>
              <ProgressBar label={`${name} storage used`} value={status.usedBytes} max={Math.max(status.totalBytes, 1)} tone="cyan" />
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
          {connectError === null || (!connected && connection !== 'error') ? null : (
            <div className="ovl-settings__providerMeta">{connectError}</div>
          )}
        </div>
        <Button
          variant={connected ? 'secondary' : 'primary'}
          disabled={connection === 'loading' || connectionOperation !== null || descriptor?.available === false}
          onClick={() => {
            if (connection === 'error') {
              setStatusLoad(null);
              setConnectError(null);
              refresh();
            } else if (connected) {
              setDisconnectConfirmation(true);
            } else {
              changeConnection('connect');
            }
          }}
        >
          {disconnecting
            ? intl.formatMessage(messages.disconnecting)
            : connecting
              ? 'Connecting…'
              : connection === 'loading'
                ? 'Checking…'
                : connection === 'error'
                  ? 'Try again'
                  : connected
                    ? 'Disconnect'
                    : `Connect ${name}`}
        </Button>
      </div>

      <Dialog
        open={disconnectConfirmation}
        title={intl.formatMessage(messages.disconnectTitle, { name })}
        icon="cloud"
        width={420}
        {...(disconnecting ? {} : { onClose: () => setDisconnectConfirmation(false) })}
        footer={
          <>
            <Button variant="ghost" disabled={disconnecting} onClick={() => setDisconnectConfirmation(false)}>
              {intl.formatMessage(messages.cancel)}
            </Button>
            <Button disabled={disconnecting} onClick={() => changeConnection('disconnect')}>
              {disconnecting ? intl.formatMessage(messages.disconnecting) : intl.formatMessage(messages.disconnectProvider, { name })}
            </Button>
          </>
        }
      >
        <p className="ovl-settings__disconnectCopy">{intl.formatMessage(messages.disconnectCopy, { name })}</p>
        <div className="ovl-settings__disconnectReassure">
          <Icon name="shield-check" size={16} color="var(--accent-green)" />
          <span>{intl.formatMessage(messages.disconnectReassurance, { name })}</span>
        </div>
        {connectError === null ? null : <p className="ovl-settings__disconnectError">{connectError}</p>}
      </Dialog>

      {connection === 'disconnected' && providers.length > 1 && targetId !== null ? (
        <Field label="Backup provider" hint="Choose where encrypted library data is stored.">
          <Segmented
            label="Backup provider"
            value={targetId}
            options={providers.map((provider) => ({ value: provider.id, label: provider.label, disabled: !provider.available }))}
            onChange={(providerId) => {
              setTargetId(providerId);
              setStatusLoad(null);
              setConnectError(null);
            }}
          />
          {providers
            .filter((provider) => !provider.available && provider.unavailableReason !== null)
            .map((provider) => (
              <div key={provider.id} className="ovl-settings__providerMeta">
                {provider.label}: {provider.unavailableReason}
              </div>
            ))}
        </Field>
      ) : null}

      <Field label="Restore from cloud backup" hint="Recover a complete library with its separately saved recovery key.">
        <Button icon="cloud-download" onClick={onRestore}>
          Restore library…
        </Button>
      </Field>

      <OffloadedStorage connection={connection} selectedPhotoIds={selectedPhotoIds} />

      <Field label="Re-offload after viewing" hint="Keep cloud-only originals temporary unless you choose Keep downloaded.">
        <Switch
          accessibleLabel="Re-offload after viewing"
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
              accessibleLabel="Back up new imports automatically"
              checked={settings.autoBackupOnImport}
              onChange={(autoBackupOnImport) => {
                onPatch({ autoBackupOnImport });
              }}
            />
          </Field>
          <Field label="Wi-Fi only" hint="Pause uploads on cellular or metered connections.">
            <Switch
              accessibleLabel="Wi-Fi only"
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
        <Switch checked disabled accessibleLabel="Encrypt originals" />
      </Field>
    </div>
  );
}
