import { useState, type ReactElement } from 'react';

import { Dialog } from '../components/Dialog';
import { Icon, type IconName } from '../components/Icon';

import './settings.css';

// SettingsDialog shell (#112): the design's 640px two-pane frame — 160px
// left nav (icon+label rows), right content pane. Storage & Backup is the
// default-open section per the design. Section internals land with
// #113–#115; this ships the frame with placeholder panes.

export type SettingsSection = 'general' | 'storage' | 'privacy';

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const SECTIONS: readonly { key: SettingsSection; icon: IconName; label: string }[] = [
  { key: 'general', icon: 'sliders-horizontal', label: 'General' },
  { key: 'storage', icon: 'cloud', label: 'Storage & Backup' },
  { key: 'privacy', icon: 'shield-check', label: 'Privacy' },
];

function Placeholder({ label }: { readonly label: string }): ReactElement {
  return <div className="ovl-settings__placeholder">{label} settings land here next.</div>;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): ReactElement | null {
  const [section, setSection] = useState<SettingsSection>('storage');

  if (!open) {
    return null;
  }

  const active = SECTIONS.find((candidate) => candidate.key === section) ?? SECTIONS[1];

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
          {active === undefined ? null : <Placeholder label={active.label} />}
        </div>
      </div>
    </Dialog>
  );
}
