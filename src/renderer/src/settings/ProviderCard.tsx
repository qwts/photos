import type { ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import './settings.css';
import { useFormats } from '../i18n/use-formats.js';
import { Badge } from '../components/Badge';
import { Button, type ButtonVariant } from '../components/Button';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';

// Provider storage card (#684). Presentation only — a pure view of one
// provider's status so every state has its own Storybook story. It renders the
// two-figure body from the design spec: "Used by Overlook" (what Overlook
// measures of its own remote objects) and, separately, account capacity, which
// appears ONLY as a source-gated ProgressBar when a verified quota API supplies
// it. iCloud has no such API, so it shows the used figure plus a System Settings
// route — never a fabricated total and never local disk space. Loading, stale,
// and calculation-failure states never change the connection badge.

export type ProviderConnectionState = 'connected' | 'disconnected' | 'checking' | 'error';

export interface ProviderUsageView {
  /** Exact bytes of Overlook's own remote objects; null while measuring/absent. */
  readonly bytes: number | null;
  /** Measurement failed and no prior figure is retained → calculation-failure. */
  readonly failed: boolean;
  /** A retained figure is shown but is not current (offline/failed refresh). */
  readonly stale: boolean;
  /** e.g. "Last measured 2 hours ago · offline"; shown under a stale figure. */
  readonly staleLabel: string | null;
}

export type ProviderCapacityView =
  | { readonly kind: 'known'; readonly usedBytes: number; readonly totalBytes: number }
  | { readonly kind: 'route' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'none' };

export interface ProviderCardProps {
  readonly name: string;
  readonly connection: ProviderConnectionState;
  readonly account: string | null;
  readonly usage: ProviderUsageView;
  readonly capacity: ProviderCapacityView;
  readonly capabilitiesLine: string | null;
  /** Backend reason for the disconnected/error state (a failed connect's reason),
   * or null to fall back to the card's own default copy. */
  readonly message: string | null;
  /** Serialized polite announcement (measuring / updated / stale / failure). */
  readonly announcement: string | null;
  readonly primaryLabel: string;
  readonly primaryVariant: ButtonVariant;
  readonly primaryDisabled: boolean;
  readonly onPrimary: () => void;
  /** Whether the usage Refresh/Retry control is offered (connected only). */
  readonly canRefresh: boolean;
  readonly refreshLabel: string;
  readonly onRefresh: () => void;
  readonly onCapacityRoute: () => void;
}

const messages = defineMessages({
  checking: { id: 'settings.provider.badge.checking', defaultMessage: 'Checking…' },
  connected: { id: 'settings.provider.badge.connected', defaultMessage: 'Connected' },
  statusUnavailable: { id: 'settings.provider.badge.unavailable', defaultMessage: 'Status unavailable' },
  notConnected: { id: 'settings.provider.badge.notConnected', defaultMessage: 'Not connected' },
  checkingConnection: { id: 'settings.provider.checkingConnection', defaultMessage: 'Checking connection…' },
  couldNotCheck: { id: 'settings.provider.couldNotCheck', defaultMessage: 'Could not check this provider’s connection.' },
  measurementFailed: { id: 'settings.provider.measurementFailed', defaultMessage: 'Couldn’t measure usage right now.' },
  usedLabel: { id: 'settings.provider.usedByOverlook', defaultMessage: 'Used by Overlook' },
  measuring: { id: 'settings.provider.measuring', defaultMessage: 'Measuring your backups…' },
  usedAccessible: {
    id: 'settings.provider.usedAccessible',
    defaultMessage: 'Used by Overlook, {human}, {exact} bytes',
  },
  capacityBar: { id: 'settings.provider.capacityBar', defaultMessage: '{name} capacity' },
  capacityDetail: { id: 'settings.provider.capacityDetail', defaultMessage: '{used} of {total} used' },
  capacityRoute: { id: 'settings.provider.capacityRoute', defaultMessage: '{name} capacity — View in System Settings' },
  opensSettings: { id: 'settings.provider.opensSettings', defaultMessage: ' (opens System Settings)' },
  capacityUnavailable: { id: 'settings.provider.capacityUnavailable', defaultMessage: 'Account capacity unavailable.' },
  regionLabel: { id: 'settings.provider.regionLabel', defaultMessage: '{name} backup' },
  connectHint: { id: 'settings.provider.connectHint', defaultMessage: 'Link a provider to store encrypted originals off-device.' },
});

export function ProviderCard(props: ProviderCardProps): ReactElement {
  const intl = useIntl();
  const { formatBytes, formatCount } = useFormats();
  const { name, connection, account, usage, capacity } = props;
  const connected = connection === 'connected';
  const usedLabel = intl.formatMessage(messages.usedLabel);

  const usedName =
    usage.bytes === null
      ? undefined
      : intl.formatMessage(messages.usedAccessible, { human: formatBytes(usage.bytes), exact: formatCount(usage.bytes) });

  return (
    <div
      className="ovl-settings__provider"
      role="group"
      aria-label={intl.formatMessage(messages.regionLabel, { name })}
      data-testid="provider-card"
    >
      <Icon name="cloud" size={20} color={connected ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
      <div className="ovl-settings__providerBody">
        <div className="ovl-settings__providerHead">
          <span className="ovl-settings__providerName">{name}</span>
          {connection === 'checking' ? (
            <Badge tone="neutral">{intl.formatMessage(messages.checking)}</Badge>
          ) : connected ? (
            <Badge tone="green" icon="cloud-check">
              {intl.formatMessage(messages.connected)}
            </Badge>
          ) : connection === 'error' ? (
            <Badge tone="neutral" icon="cloud-alert">
              {intl.formatMessage(messages.statusUnavailable)}
            </Badge>
          ) : (
            <Badge tone="neutral">{intl.formatMessage(messages.notConnected)}</Badge>
          )}
        </div>

        {account === null ? null : <div className="ovl-settings__providerMeta mono-data">{account}</div>}

        {connection === 'checking' ? (
          <div className="ovl-settings__providerMeta">{intl.formatMessage(messages.checkingConnection)}</div>
        ) : connection === 'error' ? (
          // Prefer the backend's actionable reason (OAuth/config/custody failure)
          // when a connect attempt supplied one; else the generic status copy.
          <div className="ovl-settings__providerMeta">{props.message ?? intl.formatMessage(messages.couldNotCheck)}</div>
        ) : connected ? (
          <>
            {usage.failed ? (
              <div className="ovl-settings__providerMeta" role="status">
                {intl.formatMessage(messages.measurementFailed)}
              </div>
            ) : usage.bytes === null ? (
              <div className="ovl-settings__providerFigure ovl-settings__providerFigure--loading">
                <span className="ovl-settings__providerFigureLabel">{usedLabel}</span>
                <span className="ovl-settings__providerMeta">{intl.formatMessage(messages.measuring)}</span>
              </div>
            ) : (
              <>
                <div className="ovl-settings__providerFigure" data-stale={usage.stale ? '' : undefined}>
                  <span className="ovl-settings__providerFigureLabel">{usedLabel}</span>
                  <span className="ovl-settings__providerFigureValue mono-data" aria-label={usedName}>
                    {formatBytes(usage.bytes)}
                  </span>
                </div>
                {usage.stale && usage.staleLabel !== null ? (
                  <div className="ovl-settings__providerStale mono-data">{usage.staleLabel}</div>
                ) : null}
              </>
            )}

            {capacity.kind === 'known' ? (
              <ProgressBar
                label={intl.formatMessage(messages.capacityBar, { name })}
                detail={intl.formatMessage(messages.capacityDetail, {
                  used: formatBytes(capacity.usedBytes),
                  total: formatBytes(capacity.totalBytes),
                })}
                value={capacity.usedBytes}
                max={Math.max(capacity.totalBytes, 1)}
                tone="cyan"
              />
            ) : capacity.kind === 'route' ? (
              <button type="button" className="ovl-settings__providerRoute" onClick={props.onCapacityRoute}>
                <Icon name="sliders-horizontal" size={14} />
                {intl.formatMessage(messages.capacityRoute, { name })}
                <span className="ovl-sr-only">{intl.formatMessage(messages.opensSettings)}</span>
              </button>
            ) : capacity.kind === 'unavailable' ? (
              <div className="ovl-settings__providerMeta">{intl.formatMessage(messages.capacityUnavailable)}</div>
            ) : null}

            {props.capabilitiesLine === null ? null : <div className="ovl-settings__providerMeta mono-data">{props.capabilitiesLine}</div>}
          </>
        ) : (
          <div className="ovl-settings__providerMeta">{props.message ?? intl.formatMessage(messages.connectHint)}</div>
        )}

        {connected && props.canRefresh ? (
          <div className="ovl-settings__providerRefresh">
            <button type="button" className="ovl-settings__providerRoute" onClick={props.onRefresh}>
              <Icon name="refresh-cw" size={14} />
              {props.refreshLabel}
            </button>
          </div>
        ) : null}

        <div className="ovl-sr-only" role="status" aria-live="polite">
          {props.announcement}
        </div>
      </div>

      <Button variant={props.primaryVariant} disabled={props.primaryDisabled} onClick={props.onPrimary}>
        {props.primaryLabel}
      </Button>
    </div>
  );
}
