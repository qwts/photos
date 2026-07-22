import type { ReactElement } from 'react';

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
  /** Body copy shown when disconnected (connect hint or a connection error). */
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

const USED_LABEL = 'Used by Overlook';

export function ProviderCard(props: ProviderCardProps): ReactElement {
  const { formatBytes, formatCount } = useFormats();
  const { name, connection, account, usage, capacity } = props;
  const connected = connection === 'connected';

  const usedName = usage.bytes === null ? null : `${USED_LABEL}, ${formatBytes(usage.bytes)}, ${formatCount(usage.bytes)} bytes`;

  return (
    <div className="ovl-settings__provider" role="group" aria-label={`${name} backup`} data-testid="provider-card">
      <Icon name="cloud" size={20} color={connected ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
      <div className="ovl-settings__providerBody">
        <div className="ovl-settings__providerHead">
          <span className="ovl-settings__providerName">{name}</span>
          {connection === 'checking' ? (
            <Badge tone="neutral">Checking…</Badge>
          ) : connected ? (
            <Badge tone="green" icon="cloud-check">
              Connected
            </Badge>
          ) : connection === 'error' ? (
            <Badge tone="neutral" icon="cloud-alert">
              Status unavailable
            </Badge>
          ) : (
            <Badge tone="neutral">Not connected</Badge>
          )}
        </div>

        {account === null ? null : <div className="ovl-settings__providerMeta mono-data">{account}</div>}

        {connection === 'checking' ? (
          <div className="ovl-settings__providerMeta">Checking connection…</div>
        ) : connection === 'error' ? (
          <div className="ovl-settings__providerMeta">Could not check this provider’s connection.</div>
        ) : connected ? (
          <>
            {usage.failed ? (
              <div className="ovl-settings__providerMeta" role="status">
                Couldn’t measure usage right now.
              </div>
            ) : usage.bytes === null ? (
              <div className="ovl-settings__providerFigure ovl-settings__providerFigure--loading">
                <span className="ovl-settings__providerFigureLabel">{USED_LABEL}</span>
                <span className="ovl-settings__providerMeta">Measuring your backups…</span>
              </div>
            ) : (
              <>
                <div className="ovl-settings__providerFigure" data-stale={usage.stale ? '' : undefined}>
                  <span className="ovl-settings__providerFigureLabel">{USED_LABEL}</span>
                  <span className="ovl-settings__providerFigureValue mono-data" aria-label={usedName ?? undefined}>
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
                label={`${name} capacity`}
                detail={`${formatBytes(capacity.usedBytes)} of ${formatBytes(capacity.totalBytes)} used`}
                value={capacity.usedBytes}
                max={Math.max(capacity.totalBytes, 1)}
                tone="cyan"
              />
            ) : capacity.kind === 'route' ? (
              <button type="button" className="ovl-settings__providerRoute" onClick={props.onCapacityRoute}>
                <Icon name="sliders-horizontal" size={14} />
                {name} capacity — View in System Settings
                <span className="ovl-sr-only"> (opens System Settings)</span>
              </button>
            ) : capacity.kind === 'unavailable' ? (
              <div className="ovl-settings__providerMeta">Account capacity unavailable.</div>
            ) : null}

            {props.capabilitiesLine === null ? null : <div className="ovl-settings__providerMeta mono-data">{props.capabilitiesLine}</div>}
          </>
        ) : (
          <div className="ovl-settings__providerMeta">{props.message}</div>
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
