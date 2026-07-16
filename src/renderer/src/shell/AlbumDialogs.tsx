import { useState, type FormEvent, type ReactElement } from 'react';

import type { AlbumSummary } from '../../../shared/library/types.js';
import { formatCount } from '../../../shared/library/format.js';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';

export function RenameAlbumDialog({
  album,
  onClose,
  onComplete,
}: {
  readonly album: AlbumSummary;
  readonly onClose: () => void;
  readonly onComplete: (name: string) => void;
}): ReactElement {
  const [name, setName] = useState(album.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (trimmed === '' || trimmed === album.name || saving) return;
    setSaving(true);
    setError(null);
    void window.overlook.albums
      .rename({ albumId: album.id, name: trimmed })
      .then(() => onComplete(trimmed))
      .catch(() => {
        setSaving(false);
        setError('Could not rename this album. Try again.');
      });
  };
  return (
    <Dialog
      open
      title="Rename album"
      icon="album"
      {...(saving ? {} : { onClose })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`rename-${album.id}`} disabled={trimmed === '' || trimmed === album.name || saving}>
            {saving ? 'Saving…' : 'Rename'}
          </Button>
        </>
      }
    >
      <form id={`rename-${album.id}`} onSubmit={submit}>
        <label className="ovl-album-dialog__label" htmlFor={`album-name-${album.id}`}>
          Album name
        </label>
        <input
          id={`album-name-${album.id}`}
          className="ovl-album-dialog__input"
          value={name}
          maxLength={120}
          autoFocus
          onChange={(event) => setName(event.currentTarget.value)}
        />
        {error === null ? null : (
          <div className="ovl-album-dialog__error" role="alert">
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

export function DeleteAlbumDialog({
  album,
  onClose,
  onComplete,
}: {
  readonly album: AlbumSummary;
  readonly onClose: () => void;
  readonly onComplete: () => void;
}): ReactElement {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = album.count === 1 ? 'photo stays' : 'photos stay';
  const remove = (): void => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    void window.overlook.albums
      .delete({ albumId: album.id })
      .then(onComplete)
      .catch(() => {
        setDeleting(false);
        setError('Could not delete this album. Try again.');
      });
  };
  return (
    <Dialog
      open
      title="Delete album"
      icon="trash-2"
      {...(deleting ? {} : { onClose })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete album'}
          </Button>
        </>
      }
    >
      <p>Delete “{album.name}”?</p>
      <p className="ovl-album-dialog__safe-copy">
        Only the album and its memberships are removed. All {formatCount(album.count)} {noun} in your library.
      </p>
      {error === null ? null : (
        <div className="ovl-album-dialog__error" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
