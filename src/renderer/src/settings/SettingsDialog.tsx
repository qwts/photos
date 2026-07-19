import { useEffect, useRef, useState, type ReactElement } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import type { MessageDescriptor } from 'react-intl';

import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { GeneralPane } from './GeneralPane';
import { KeyDialog, type KeyDialogMode } from './KeyDialog';
import { PrivacyPane } from './PrivacyPane';
import { StoragePane } from './StoragePane';
import { RestoreWorkflow } from '../restore/RestoreWorkflow';
import { AppPasswordDialog, type AppPasswordMode } from './AppPasswordDialog';
import type { AppSettings, SettingsPatch } from '../../../shared/settings/settings.js';

import './settings.css';

// SettingsDialog shell (#112): the design's 640px two-pane frame — 160px
// left nav (icon+label rows), right content pane. Storage & Backup is the
// default-open section per the design. The dialog reads the store once on
// open and follows changed pushes — one truth for every pane (#113+).

export type SettingsSection = 'general' | 'storage' | 'transfer' | 'privacy';

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly selectedPhotoIds?: readonly string[] | undefined;
  readonly onTransfer?: (() => void) | undefined;
}

const messages = defineMessages({
  title: { id: 'settings.title', defaultMessage: 'Settings' },
  sections: { id: 'settings.nav.label', defaultMessage: 'Settings sections' },
  general: { id: 'settings.nav.general', defaultMessage: 'General' },
  storage: { id: 'settings.nav.storage', defaultMessage: 'Storage & Backup' },
  transfer: { id: 'settings.nav.transfer', defaultMessage: 'Transfer & Sync' },
  privacy: { id: 'settings.nav.privacy', defaultMessage: 'Privacy' },
  transferSettings: { id: 'settings.transfer.label', defaultMessage: 'Transfer and Sync settings' },
  restoreTitle: { id: 'settings.restore.title', defaultMessage: 'Restore from cloud backup' },
});

const SECTIONS: readonly { key: SettingsSection; icon: IconName; label: MessageDescriptor }[] = [
  { key: 'general', icon: 'sliders-horizontal', label: messages.general },
  { key: 'storage', icon: 'cloud', label: messages.storage },
  { key: 'transfer', icon: 'refresh-cw', label: messages.transfer },
  { key: 'privacy', icon: 'shield-check', label: messages.privacy },
];

export function SettingsDialog({ open, onClose, selectedPhotoIds = [], onTransfer }: SettingsDialogProps): ReactElement | null {
  const intl = useIntl();
  const [section, setSection] = useState<SettingsSection>('storage');
  const paneRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Recovery-key dialog (#240): layered over Settings, per the mock.
  const [keyMode, setKeyMode] = useState<KeyDialogMode | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [passwordMode, setPasswordMode] = useState<AppPasswordMode | null>(null);
  const [appLockConfigured, setAppLockConfigured] = useState(false);
  const [touchIdStatus, setTouchIdStatus] = useState<Awaited<ReturnType<typeof window.overlook.appLock.touchIdStatus>> | null>(null);
  const [touchIdBusy, setTouchIdBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    let changed = false;
    const unsubscribe = window.overlook.settings.onChanged((payload) => {
      changed = true;
      setSettings(payload.settings);
    });
    void window.overlook.settings.get().then((response) => {
      if (active && !changed) setSettings(response.settings);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const sync = (state: string): void => setAppLockConfigured(state === 'unlocked');
    void window.overlook.appLock.status().then(({ state }) => sync(state));
    return window.overlook.appLock.onChanged(({ state }) => sync(state));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void window.overlook.appLock.touchIdStatus().then(setTouchIdStatus);
    return window.overlook.appLock.onTouchIdChanged((status) => {
      setTouchIdStatus(status);
      setTouchIdBusy(false);
    });
  }, [open]);

  if (!open) {
    return null;
  }

  const patch = (value: SettingsPatch): void => {
    void window.overlook.settings.set({ patch: value }).then((response) => {
      setSettings(response.settings);
    });
  };

  const selectSection = (nextSection: SettingsSection): void => {
    if (nextSection === section) return;
    if (paneRef.current !== null) paneRef.current.scrollTop = 0;
    setSection(nextSection);
  };

  return (
    <Dialog
      open
      title={intl.formatMessage(messages.title)}
      icon="settings-2"
      width={640}
      bodyClassName="ovl-dialog__body--settings"
      onClose={onClose}
    >
      <div className="ovl-settings" data-testid="settings-dialog">
        <nav className="ovl-settings__nav" aria-label={intl.formatMessage(messages.sections)}>
          {SECTIONS.map(({ key, icon, label }) => {
            const current = key === section;
            return (
              <button
                key={key}
                type="button"
                className={`ovl-settings__navrow${current ? ' ovl-settings__navrow--active' : ''}`}
                aria-current={current}
                onClick={() => {
                  selectSection(key);
                }}
              >
                <Icon name={icon} size={14} color={current ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
                <span>{intl.formatMessage(label)}</span>
              </button>
            );
          })}
        </nav>
        <div ref={paneRef} className="ovl-settings__pane" data-testid="settings-pane" data-section={section}>
          {settings === null ? null : section === 'general' ? (
            <GeneralPane settings={settings} onPatch={patch} />
          ) : section === 'storage' ? (
            <StoragePane settings={settings} selectedPhotoIds={selectedPhotoIds} onPatch={patch} onRestore={() => setRestoreOpen(true)} />
          ) : section === 'transfer' ? (
            <section className="ovl-settings__transfer" aria-label={intl.formatMessage(messages.transferSettings)}>
              <h3>
                <FormattedMessage id="settings.transfer.heading" defaultMessage="Transfer & Sync" />
              </h3>
              <p>
                <FormattedMessage
                  id="settings.transfer.body"
                  defaultMessage="Pair Overlook with Image Trail through an isolated encrypted provider namespace. Backup credentials and files are never reused."
                />
              </p>
              <p className="mono-data">
                <FormattedMessage id="settings.transfer.status" defaultMessage="Not paired · provider not connected" />
              </p>
              <Button className="ovl-settings__transferAction" variant="primary" icon="refresh-cw" onClick={onTransfer}>
                <FormattedMessage id="settings.transfer.open" defaultMessage="Open Transfer & Sync" />
              </Button>
            </section>
          ) : (
            <PrivacyPane
              settings={settings}
              onPatch={patch}
              onKeyAction={setKeyMode}
              appLockConfigured={appLockConfigured}
              onPasswordAction={setPasswordMode}
              onLockNow={() => void window.overlook.appLock.lockNow()}
              touchIdStatus={touchIdStatus}
              touchIdBusy={touchIdBusy}
              onTouchIdChange={(enabled) => {
                if (enabled) {
                  setPasswordMode('touch-id');
                  return;
                }
                setTouchIdBusy(true);
                void window.overlook.appLock
                  .touchIdDisable()
                  .then(({ disabled }) => {
                    if (!disabled) setTouchIdBusy(false);
                  })
                  .catch(() => setTouchIdBusy(false));
              }}
            />
          )}
        </div>
      </div>
      {keyMode !== null ? (
        <KeyDialog
          open
          mode={keyMode}
          onClose={() => {
            setKeyMode(null);
          }}
        />
      ) : null}
      {restoreOpen ? (
        <Dialog
          open
          title={intl.formatMessage(messages.restoreTitle)}
          icon="cloud-download"
          width={640}
          onClose={() => setRestoreOpen(false)}
        >
          <RestoreWorkflow context="settings" />
        </Dialog>
      ) : null}
      {passwordMode === null ? null : (
        <AppPasswordDialog mode={passwordMode} onClose={() => setPasswordMode(null)} onDone={() => setPasswordMode(null)} />
      )}
    </Dialog>
  );
}
