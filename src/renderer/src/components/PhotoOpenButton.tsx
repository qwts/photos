import type { DragEvent, ReactElement } from 'react';
import { useIntl } from 'react-intl';

import { directionOf } from '../../../shared/i18n/locales.js';

export interface PhotoOpenButtonProps {
  readonly label: string;
  readonly className: string;
  readonly onOpen?: (() => void) | undefined;
  readonly onContextAction?: ((point: { readonly x: number; readonly y: number }) => void) | undefined;
  readonly onDragStart?: ((event: DragEvent<HTMLButtonElement>) => void) | undefined;
  readonly onDragEnd?: (() => void) | undefined;
}

export function PhotoOpenButton({ label, className, onOpen, onContextAction, onDragStart, onDragEnd }: PhotoOpenButtonProps): ReactElement {
  const direction = directionOf(useIntl().locale);
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup={onContextAction === undefined ? undefined : 'menu'}
      className={className}
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onContextMenu={
        onContextAction === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              onContextAction({ x: event.clientX, y: event.clientY });
            }
      }
      onKeyDown={
        onContextAction === undefined
          ? undefined
          : (event) => {
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                onContextAction({ x: direction === 'rtl' ? bounds.left - 224 : bounds.right + 4, y: bounds.top });
              }
            }
      }
    />
  );
}
