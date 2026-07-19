import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const dialogStack: symbol[] = [];

function trapTab(event: KeyboardEvent, panel: HTMLDivElement): void {
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
}

export function useDialogKeyboard(rendered: boolean, panelRef: RefObject<HTMLDivElement>, requestClose: () => void): void {
  const stackTokenRef = useRef<symbol>(Symbol('dialog'));
  useEffect(() => {
    if (!rendered) return;
    const token = stackTokenRef.current;
    dialogStack.push(token);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dialogStack.at(-1) !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      } else if (event.key === 'Tab' && panelRef.current !== null) {
        trapTab(event, panelRef.current);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      const index = dialogStack.indexOf(token);
      if (index !== -1) dialogStack.splice(index, 1);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panelRef, rendered, requestClose]);
}
