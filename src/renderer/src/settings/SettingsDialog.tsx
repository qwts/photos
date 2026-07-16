import { useEffect, useState, type ReactElement } from 'react';

import { Dialog } from '../components/Dialog';
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

const SECTIONS: readonly { key: SettingsSection; icon: IconName; label: string }[] = [
  { key: 'general', icon: 'sliders-horizontal', label: 'General' },
  { key: 'storage', icon: 'cloud', label: 'Storage & Backup' },
  { key: 'transfer', icon: 'refresh-cw', label: 'Transfer & Sync' },
  { key: 'privacy', icon: 'shield-check', label: 'Privacy' },
];

export function SettingsDialog({ open, onClose, selectedPhotoIds = [], onTransfer }: SettingsDialogProps): ReactElement | null {
  const [section, setSection] = useState<SettingsSection>('storage');
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
    void window.overlook.settings.get().then((response) => {
      setSettings(response.settings);
    });
    return window.overlook.settings.onChanged((payload) => {
      setSettings(payload.settings);
    });
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

  return (
    <Dialog open title="Settings" icon="settings-2" width={640} onClose={onClose}>
      <div className="ovl-settings" data-testid="settings-dialog">
        <nav className="ovl-settings__nav" aria-label="Settings sections">
          {SECTIONS.map(({ key, icon, label }) => {
            const current = key === section;
            return (
              <button
                key={key}
                type="button"
                className={`ovl-settings__navrow${current ? ' ovl-settings__navrow--active' : ''}`}
                aria-current={current}
                onClick={() => {
                  setSection(key);
                }}
              >
                <Icon name={icon} size={14} color={current ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="ovl-settings__pane" data-testid="settings-pane">
          {settings === null ? null : section === 'general' ? (
            <GeneralPane settings={settings} onPatch={patch} />
          ) : section === 'storage' ? (
            <StoragePane settings={settings} selectedPhotoIds={selectedPhotoIds} onPatch={patch} onRestore={() => setRestoreOpen(true)} />
          ) : section === 'transfer' ? (
            <section className="ovl-settings__transfer" aria-label="Transfer and Sync settings">
              <h3>Transfer &amp; Sync</h3>
              <p>
                Pair Overlook with Image Trail through an isolated encrypted provider namespace. Backup credentials and files are never
                reused.
              </p>
              <p className="mono-data">NOT PAIRED · PROVIDER NOT CONNECTED</p>
              <button type="button" onClick={onTransfer}>
                Open Transfer &amp; Sync
              </button>
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
        <Dialog open title="Restore from cloud backup" icon="cloud-download" width={640} onClose={() => setRestoreOpen(false)}>
          <RestoreWorkflow context="settings" />
        </Dialog>
      ) : null}
      {passwordMode === null ? null : (
        <AppPasswordDialog mode={passwordMode} onClose={() => setPasswordMode(null)} onDone={() => setPasswordMode(null)} />
      )}
    </Dialog>
  );
}
