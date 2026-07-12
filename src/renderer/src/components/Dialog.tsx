import { useEffect, useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

import './overlays.css';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly icon?: IconName;
  /** 420 (flow dialogs) or 640 (settings) per the design. */
  readonly width?: number;
  readonly onClose?: () => void;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// feedback/Dialog.jsx, upgraded per #59: aria-modal + labelled title, Esc
// closes, and focus is trapped inside while open (the mock only had
// backdrop-click + stopPropagation, which are kept).
export function Dialog({ open, title, icon, width = 420, onClose, footer, children }: DialogProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || panel === null) {
        return;
      }
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }
  return (
    <div className="ovl-dialog-scrim" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ovl-dialog"
        style={{ width }}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="ovl-dialog__header">
          {icon === undefined ? null : <Icon name={icon} size={18} color="var(--text-muted)" />}
          <div id={titleId} className="ovl-dialog__title">
            {title}
          </div>
          {onClose === undefined ? null : <IconButton icon="x" label="Close" size="sm" onClick={onClose} />}
        </div>
        <div className="ovl-dialog__body">{children}</div>
        {footer === undefined ? null : <div className="ovl-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}
