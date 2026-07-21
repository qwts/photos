import { useState, type ReactElement } from 'react';

import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { PasswordField } from '../components/PasswordField';

export interface ProtectedAlbumUnlockDialogProps {
  readonly albumId: string;
  readonly onClose: () => void;
  readonly onDone: (outcome: 'opened' | 'protection-completed' | 'removal-completed') => void;
}

export function ProtectedAlbumUnlockDialog({ albumId, onClose, onDone }: ProtectedAlbumUnlockDialogProps): ReactElement {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = (): void => {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError('');
    void window.overlook.protectedAlbums
      .unlock({ albumId, password })
      .then(({ ok, outcome }) => {
        if (!ok || outcome === null) {
          setError('Unable to unlock. Check the password or use recovery in Settings → Privacy.');
          return;
        }
        setPassword('');
        onDone(outcome);
      })
      .catch(() => setError('Protected content is unavailable. Nothing was exposed.'))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open
      title="Unlock protected album"
      icon="lock"
      width={420}
      {...(busy ? {} : { onClose })}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button icon="lock" disabled={busy || password.length === 0} onClick={submit}>
            {busy ? 'Unlocking…' : 'Unlock for this session'}
          </Button>
        </>
      }
    >
      <form
        className="ovl-protected-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="ovl-keynote ovl-keynote--amber">
          <Icon name="shield-check" size={15} color="var(--accent-amber)" />
          <div className="ovl-keynote__body">
            The album name, count, dates, and photos remain sealed until its independent password releases this session’s key.
          </div>
        </div>
        <label>
          <div className="ovl-key__label mono-data">Album password</div>
          <PasswordField
            value={password}
            onChange={setPassword}
            label="Album password"
            name="protected-album-password"
            autoComplete="current-password"
            autoFocus
          />
        </label>
        <div className="ovl-key__mismatch" role="status" aria-live="polite">
          {error}
        </div>
      </form>
    </Dialog>
  );
}
