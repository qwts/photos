import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import type { InteropInboundStatus } from '../../../shared/interop/inbound-ui.js';
import { Button } from '../components/Button.js';

export interface TransferPaneProps {
  readonly onOpen: (() => void) | undefined;
}

const messages = defineMessages({
  label: { id: 'settings.transfer.label', defaultMessage: 'Transfer and Sync settings' },
  heading: { id: 'settings.transfer.heading', defaultMessage: 'Transfer & Sync' },
  body: {
    id: 'settings.transfer.body',
    defaultMessage: 'Receive encrypted Image Trail moves through a pCloud authorization used only for interoperability.',
  },
  provider: { id: 'settings.transfer.provider', defaultMessage: 'pCloud for interoperability' },
  pairing: { id: 'settings.transfer.pairing', defaultMessage: 'Image Trail pairing' },
  checking: { id: 'settings.transfer.checking', defaultMessage: 'Checking…' },
  connected: { id: 'settings.transfer.connected', defaultMessage: 'connected' },
  disconnected: { id: 'settings.transfer.disconnected', defaultMessage: 'not connected' },
  expired: { id: 'settings.transfer.expired', defaultMessage: 'reconnect required' },
  connect: { id: 'settings.transfer.connect', defaultMessage: 'Connect pCloud' },
  disconnect: { id: 'settings.transfer.disconnect', defaultMessage: 'Disconnect' },
  notConfigured: { id: 'settings.transfer.notConfigured', defaultMessage: 'not configured' },
  locked: { id: 'settings.transfer.locked', defaultMessage: 'locked' },
  unlocked: { id: 'settings.transfer.unlocked', defaultMessage: 'unlocked' },
  select: { id: 'settings.transfer.select', defaultMessage: 'Select bundle…' },
  replace: { id: 'settings.transfer.replace', defaultMessage: 'Replace bundle…' },
  password: { id: 'settings.transfer.password', defaultMessage: 'Pairing bundle password' },
  unlock: { id: 'settings.transfer.unlock', defaultMessage: 'Unlock for this session' },
  refresh: { id: 'settings.transfer.refresh', defaultMessage: 'Check for incoming transfers' },
  review: {
    id: 'settings.transfer.review',
    defaultMessage: '{count, plural, one {Review # incoming item} other {Review # incoming items}}',
  },
  unavailable: { id: 'settings.transfer.unavailable', defaultMessage: 'Outbound Move and Sync are not available yet.' },
});

export function TransferPane({ onOpen }: TransferPaneProps): ReactElement {
  const intl = useIntl();
  const [status, setStatus] = useState<InteropInboundStatus | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let receivedPush = false;
    const unsubscribe = window.overlook.interop.onChanged((next) => {
      receivedPush = true;
      if (active) setStatus(next);
    });
    void window.overlook.interop.status().then(async (initial) => {
      if (!active || receivedPush) return;
      setStatus(initial);
      if (initial.provider.status === 'connected' && initial.pairing.status === 'unlocked') {
        setBusy(true);
        try {
          const refreshed = await window.overlook.interop.refresh();
          if (active) setStatus(refreshed);
        } finally {
          if (active) setBusy(false);
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = (operation: () => Promise<InteropInboundStatus>): void => {
    setBusy(true);
    void operation()
      .then(setStatus)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const unlock = (event: FormEvent): void => {
    event.preventDefault();
    const oneShotPassword = password;
    setPassword('');
    run(() => window.overlook.interop.unlockPairing({ password: oneShotPassword }));
  };
  const transferCount = status?.batches.reduce((total, batch) => total + batch.counts.total, 0) ?? 0;
  const workActive =
    status !== null && ['transferring', 'paused', 'awaiting-acknowledgement', 'finalizing'].includes(status.progress.phase);
  const providerConnected = status?.provider.status === 'connected';
  const pairingUnlocked = status?.pairing.status === 'unlocked';
  const providerStatus =
    status === null
      ? messages.checking
      : status.provider.status === 'connected'
        ? messages.connected
        : status.provider.status === 'expired'
          ? messages.expired
          : messages.disconnected;
  const pairingStatus =
    status === null
      ? messages.checking
      : status.pairing.status === 'unlocked'
        ? messages.unlocked
        : status.pairing.status === 'locked'
          ? messages.locked
          : messages.notConfigured;

  return (
    <section className="ovl-settings__transfer" aria-label={intl.formatMessage(messages.label)}>
      <h3>{intl.formatMessage(messages.heading)}</h3>
      <p>{intl.formatMessage(messages.body)}</p>

      <div className="ovl-settings__transferCard" data-testid="interop-provider-card">
        <div>
          <strong>{intl.formatMessage(messages.provider)}</strong>
          <p className="mono-data">{intl.formatMessage(providerStatus)}</p>
        </div>
        {providerConnected ? (
          <Button
            variant="secondary"
            disabled={busy || workActive || status?.provider.busy === true}
            onClick={() => run(() => window.overlook.interop.disconnectProvider({ provider: 'pcloud' }))}
          >
            {intl.formatMessage(messages.disconnect)}
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={busy || status?.provider.busy === true}
            onClick={() => run(() => window.overlook.interop.connectProvider({ provider: 'pcloud' }))}
          >
            {intl.formatMessage(messages.connect)}
          </Button>
        )}
      </div>

      <div className="ovl-settings__transferCard" data-testid="interop-pairing-card">
        <div>
          <strong>{intl.formatMessage(messages.pairing)}</strong>
          <p className="mono-data">{intl.formatMessage(pairingStatus)}</p>
        </div>
        <Button variant="secondary" disabled={busy || workActive} onClick={() => run(() => window.overlook.interop.selectPairing())}>
          {intl.formatMessage(status?.pairing.status === 'not-configured' ? messages.select : messages.replace)}
        </Button>
      </div>

      {status?.pairing.status === 'locked' ? (
        <form className="ovl-settings__pairingUnlock" onSubmit={unlock}>
          <label htmlFor="interop-pairing-password">{intl.formatMessage(messages.password)}</label>
          <input
            id="interop-pairing-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
            {intl.formatMessage(messages.unlock)}
          </Button>
        </form>
      ) : null}

      <div className="ovl-settings__transferActions">
        <Button
          variant="secondary"
          icon="refresh-cw"
          disabled={busy || workActive || !providerConnected || !pairingUnlocked}
          onClick={() => run(() => window.overlook.interop.refresh())}
        >
          {intl.formatMessage(messages.refresh)}
        </Button>
        <Button variant="primary" disabled={busy || transferCount === 0 || onOpen === undefined} onClick={onOpen}>
          {intl.formatMessage(messages.review, { count: transferCount })}
        </Button>
      </div>

      {status?.error === null || status === null ? null : (
        <p className="ovl-settings__transferError" role="alert">
          {status.error.message}
        </p>
      )}
      <p className="ovl-settings__transferUnavailable">{intl.formatMessage(messages.unavailable)}</p>
    </section>
  );
}
