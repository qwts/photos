import { useState, type ReactElement } from 'react';

import { strengthOf } from '../../../shared/crypto/password-strength.js';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { PasswordField } from '../components/PasswordField';

import './settings.css';

export type AppPasswordMode = 'set' | 'change' | 'remove';

export interface AppPasswordDialogProps {
  readonly mode: AppPasswordMode;
  readonly onClose: () => void;
  readonly onDone: () => void;
}

export function AppPasswordDialog({ mode, onClose, onDone }: AppPasswordDialogProps): ReactElement {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = mode === 'remove' ? current : password;
  const strength = strengthOf(next);
  const mismatch = mode !== 'remove' && confirm.length > 0 && confirm !== password;
  const canSubmit =
    !busy &&
    (mode === 'remove'
      ? current.length > 0
      : password.length >= 8 && password === confirm && strength.score >= 3 && (mode === 'set' || current.length > 0));

  const submit = (): void => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    const operation =
      mode === 'set'
        ? window.overlook.appLock.configure({ password })
        : mode === 'change'
          ? window.overlook.appLock.changePassword({ currentPassword: current, nextPassword: password })
          : window.overlook.appLock.remove({ password: current });
    void operation
      .then((result) => {
        const accepted = 'changed' in result ? result.changed : 'removed' in result ? result.removed : true;
        if (!accepted) {
          setError('The current password is incorrect.');
          return;
        }
        onDone();
      })
      .catch(() => setError('The password change could not be completed safely.'))
      .finally(() => setBusy(false));
  };

  const title = mode === 'set' ? 'Set app password' : mode === 'change' ? 'Change app password' : 'Remove app password';
  return (
    <Dialog
      open
      title={title}
      icon="lock"
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={mode === 'remove' ? 'danger' : 'primary'} icon="lock" disabled={!canSubmit} onClick={submit}>
            {busy ? 'Working…' : title}
          </Button>
        </>
      }
    >
      <div className="ovl-key__form">
        <div className="ovl-keynote ovl-keynote--amber">
          <Icon name="shield-check" size={15} color="var(--accent-amber)" />
          <div className="ovl-keynote__body">
            {mode === 'remove'
              ? 'Removing the app password returns custody to this OS keychain. Your separate recovery key is unchanged.'
              : 'While locked, every decrypted original stays sealed — nothing can be viewed, exported, restored, or synced until you unlock.'}
          </div>
        </div>
        {mode === 'change' || mode === 'remove' ? (
          <label>
            <div className="ovl-key__label mono-data">Current password</div>
            <PasswordField value={current} onChange={setCurrent} label="Current app password" autoFocus />
          </label>
        ) : null}
        {mode === 'remove' ? null : (
          <>
            <label>
              <div className="ovl-key__label mono-data">New password</div>
              <PasswordField value={password} onChange={setPassword} label="New app password" autoFocus={mode === 'set'} />
              <div className="ovl-key__meter" aria-label={`Password strength: ${strength.label || 'none'}`}>
                <div className="ovl-key__meterbars">
                  {Array.from({ length: 5 }, (_, index) => (
                    <span
                      key={index}
                      className="ovl-key__meterbar"
                      style={{ background: index < strength.score ? `var(--accent-${strength.tone})` : 'var(--gray-3)' }}
                    />
                  ))}
                </div>
                <span className="ovl-key__meterlabel" style={{ color: `var(--accent-${strength.tone})` }}>
                  {strength.label}
                </span>
              </div>
            </label>
            <label>
              <div className="ovl-key__label mono-data">Confirm password</div>
              <PasswordField value={confirm} onChange={setConfirm} label="Confirm app password" />
              {mismatch ? (
                <div className="ovl-key__mismatch">
                  <Icon name="triangle-alert" size={13} />
                  Passwords do not match
                </div>
              ) : null}
            </label>
          </>
        )}
        <div className="ovl-key__mismatch" role="status" aria-live="polite">
          {error}
        </div>
      </div>
    </Dialog>
  );
}
