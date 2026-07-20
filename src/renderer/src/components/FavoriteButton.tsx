import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { Icon } from './Icon';

const messages = defineMessages({
  add: { id: 'favorite.add', defaultMessage: 'Add to Favorites' },
  remove: { id: 'favorite.remove', defaultMessage: 'Remove from Favorites' },
});

export interface FavoriteButtonProps {
  readonly favorite: boolean;
  readonly pending?: boolean;
  readonly className: string;
  readonly onToggle: () => void;
}

export function FavoriteButton({ favorite, pending = false, className, onToggle }: FavoriteButtonProps): ReactElement {
  const intl = useIntl();
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
      aria-label={intl.formatMessage(favorite ? messages.remove : messages.add)}
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
