import { useEffect, type ReactElement } from 'react';

import type { ProtectedPhotoRecord } from '../../../shared/library/protected-types.js';
import { protectedFullUrl } from '../../../shared/library/full-url.js';
import { IconButton } from '../components/IconButton';

interface ProtectedLightboxProps {
  readonly albumId: string;
  readonly photo: ProtectedPhotoRecord;
  readonly imageSrc?: string | undefined;
  readonly onClose: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToggleFavorite: () => void;
}

export function ProtectedLightbox({
  albumId,
  photo,
  imageSrc,
  onClose,
  onPrevious,
  onNext,
  onToggleFavorite,
}: ProtectedLightboxProps): ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') onPrevious();
      else if (event.key === 'ArrowRight') onNext();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNext, onPrevious]);

  const taken = photo.takenAt ?? photo.importedAt;
  return (
    <div className="ovl-protected-lightbox" role="dialog" aria-modal="true" aria-label={`Viewing ${photo.fileName}`}>
      <img src={imageSrc ?? protectedFullUrl(albumId, photo.id)} alt={photo.fileName} draggable={false} />
      <div className="ovl-protected-lightbox__top">
        <IconButton icon="arrow-left" label="Back to protected album (Esc)" onClick={onClose} />
        <span className="ovl-protected-lightbox__title mono-data">
          {photo.fileName} — {taken.slice(0, 10)}
        </span>
        <IconButton icon="star" label="Favorite" active={photo.favorite} onClick={onToggleFavorite} />
        <IconButton icon="x" label="Close (Esc)" onClick={onClose} />
      </div>
      <div className="ovl-protected-lightbox__nav">
        <IconButton icon="chevron-left" size="lg" label="Previous (←)" onClick={onPrevious} />
        <IconButton icon="chevron-right" size="lg" label="Next (→)" onClick={onNext} />
      </div>
    </div>
  );
}
