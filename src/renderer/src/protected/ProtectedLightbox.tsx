import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useIntl } from 'react-intl';

import { directionOf } from '../../../shared/i18n/locales.js';
import type { ProtectedPhotoRecord } from '../../../shared/library/protected-types.js';
import { protectedFullUrl } from '../../../shared/library/full-url.js';
import { protectedThumbUrl } from '../../../shared/library/thumb-url.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { useFormats } from '../i18n/use-formats.js';
import { animationMessages } from '../lightbox/Lightbox';
import { usePrefersReducedMotion } from '../lightbox/use-reduced-motion.js';
import { lightboxStepForKey } from '../state/lightbox-direction';

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
  const intl = useIntl();
  const { formatCalendarDate } = useFormats();
  const direction = directionOf(intl.locale);
  const panelRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  // Same reduced-motion contract as the ordinary lightbox (ADR-0026 §7):
  // animated media opens on the static poster with an intentional play action.
  const animated = (photo.fileKind === 'gif' || photo.fileKind === 'webp') && photo.mediaInfo?.animated === true;
  const reducedMotion = usePrefersReducedMotion();
  // Derived, not effect-reset: consent is held per photo id (see Lightbox).
  const [animationStartedFor, setAnimationStartedFor] = useState<string | null>(null);
  const animationStarted = animationStartedFor === photo.id;
  const posterHeld = animated && reducedMotion && !animationStarted;

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (lightboxStepForKey(event.key, direction) === 1) onNext();
        else onPrevious();
      } else if (event.key === 'Tab') {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      priorFocusRef.current?.focus();
    };
  }, [direction, onClose, onNext, onPrevious]);

  const taken = photo.takenAt ?? photo.importedAt;
  return (
    <div
      ref={panelRef}
      className="ovl-protected-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${photo.fileName}`}
      tabIndex={-1}
    >
      <img
        src={posterHeld ? protectedThumbUrl(albumId, photo.id, 'mid') : (imageSrc ?? protectedFullUrl(albumId, photo.id))}
        alt={photo.fileName}
        draggable={false}
      />
      {animated && reducedMotion ? (
        <div className="ovl-protected-lightbox__animation" data-testid="protected-lightbox-animation-toggle">
          <Button
            size="sm"
            icon={posterHeld ? 'play' : 'pause'}
            aria-pressed={!posterHeld}
            onClick={() => setAnimationStartedFor(posterHeld ? photo.id : null)}
          >
            {intl.formatMessage(posterHeld ? animationMessages.play : animationMessages.stop)}
          </Button>
        </div>
      ) : null}
      <div className="ovl-protected-lightbox__top">
        <IconButton icon="arrow-left" label="Back to protected album (Esc)" onClick={onClose} />
        <span className="ovl-protected-lightbox__title mono-data">
          {photo.fileName} — {formatCalendarDate(taken)}
        </span>
        <IconButton icon="star" label="Favorite" active={photo.favorite} onClick={onToggleFavorite} />
        <IconButton icon="x" label="Close (Esc)" onClick={onClose} />
      </div>
      <div className="ovl-protected-lightbox__nav">
        <IconButton icon="chevron-left" size="lg" label={`Previous (${direction === 'rtl' ? '→' : '←'})`} onClick={onPrevious} />
        <IconButton icon="chevron-right" size="lg" label={`Next (${direction === 'rtl' ? '←' : '→'})`} onClick={onNext} />
      </div>
    </div>
  );
}
