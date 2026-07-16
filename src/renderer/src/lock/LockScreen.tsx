import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PasswordField } from '../components/PasswordField';
import { TitleBar } from '../components/TitleBar';
import { RecoveryUnlock } from './RecoveryUnlock';

import './lock-screen.css';

export interface LockScreenProps {
  readonly platform: string;
  readonly state: 'locked' | 'unlocking' | 'locking' | 'recovery-required';
  readonly retryAfterMs: number;
}

export function LockScreen({ platform, state, retryAfterMs }: LockScreenProps): ReactElement {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [deadline, setDeadline] = useState(() => Date.now() + retryAfterMs);
  const [clock, setClock] = useState(() => Date.now());
  const busy = state === 'unlocking' || state === 'locking';

  useEffect(() => {
    if (deadline <= Date.now()) return;
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (password === '' || busy || deadline > clock || state === 'recovery-required') return;
    setError('');
    void window.overlook.appLock.unlock({ password }).then((result) => {
      if (result.ok) {
        setPassword('');
        return;
      }
      setPassword('');
      setDeadline(Date.now() + result.retryAfterMs);
      setClock(Date.now());
      setError(
        result.reason === 'throttled'
          ? 'Try again after the security delay.'
          : result.reason === 'recovery-required'
            ? 'This library requires its exported recovery key.'
            : 'That password did not unlock this library.',
      );
    });
  };

  const recoveryRequired = state === 'recovery-required';
  const remainingMs = Math.max(0, deadline - clock);
  const waitSeconds = Math.ceil(remainingMs / 1000);
  return (
    <div className="ovl-lock-screen" data-testid="lock-screen">
      <TitleBar
        platform={platform}
        onMinimize={() => void window.overlook.minimizeWindow()}
        onToggleMaximize={() => void window.overlook.toggleMaximizeWindow()}
        onClose={() => void window.overlook.closeWindow()}
      />
      <main className="ovl-lock-screen__stage">
        <form className="ovl-lock-screen__card" onSubmit={submit} aria-labelledby="lock-screen-title">
          <div className="ovl-lock-screen__mark" aria-hidden="true">
            <Icon name="lock" size={20} color="var(--accent-iris)" />
          </div>
          <div className="ovl-lock-screen__wordmark mono-data">Overlook</div>
          <h1 id="lock-screen-title">{recoveryRequired ? 'Recovery required' : 'Library locked'}</h1>
          {recoveryRequired ? (
            <RecoveryUnlock />
          ) : (
            <>
              <PasswordField
                value={password}
                onChange={setPassword}
                label="App password"
                placeholder="Password"
                name="app-password"
                autoComplete="current-password"
                autoFocus
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                icon="lock"
                className="ovl-lock-screen__unlock"
                disabled={password === '' || busy || remainingMs > 0}
              >
                {busy ? 'Unlocking…' : remainingMs > 0 ? `Try again in ${String(waitSeconds)}s` : 'Unlock'}
              </Button>
            </>
          )}
          {recoveryRequired ? null : (
            <div className="ovl-lock-screen__status" role="status" aria-live="polite">
              {error}
            </div>
          )}
          <div className="ovl-lock-screen__seal mono-data">
            <Icon name="shield-check" size={13} />
            Decrypted originals stay sealed while locked
          </div>
        </form>
      </main>
    </div>
  );
}
