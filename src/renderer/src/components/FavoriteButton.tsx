import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';

import { Icon } from './Icon';

export interface FavoriteButtonProps {
  readonly favorite: boolean;
  readonly pending?: boolean;
  readonly className: string;
  readonly onToggle: () => void;
}

export function FavoriteButton({ favorite, pending = false, className, onToggle }: FavoriteButtonProps): ReactElement {
  const stopKeyboardPropagation = (event: KeyboardEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
  };
  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onToggle();
  };
  return (
    <button
      type="button"
      aria-label={favorite ? 'Remove from Favorites' : 'Add to Favorites'}
      aria-pressed={favorite}
      aria-busy={pending}
      className={`${className}${favorite ? ` ${className}--active` : ''}`}
      disabled={pending}
      onClick={toggle}
      onKeyDown={stopKeyboardPropagation}
    >
      <Icon name="star" size={13} strokeWidth={2} />
    </button>
  );
}
