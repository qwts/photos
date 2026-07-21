import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';

import { Icon, type IconName } from './Icon';
import '../grid/context-menu.css';

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly action: () => void;
  readonly detail?: string | undefined;
  readonly disabledReason?: string | undefined;
  readonly danger?: boolean | undefined;
  readonly separatorBefore?: boolean | undefined;
}

export interface ContextMenuProps {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly onClose: () => void;
  readonly closeOnSelect?: boolean | undefined;
}

export function ContextMenu({ label, x, y, items, onClose, closeOnSelect = true }: ContextMenuProps): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (): void => onClose();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    // Menu focus belongs on its menuitems per the APG composite pattern.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="ovl-context-menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const menuItems = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        if (menuItems.length === 0) return;
        const current = menuItems.indexOf(document.activeElement as HTMLButtonElement);
        const target =
          event.key === 'Home'
            ? menuItems[0]
            : event.key === 'End'
              ? menuItems.at(-1)
              : event.key === 'ArrowDown'
                ? menuItems[(current + 1) % menuItems.length]
                : menuItems[current === -1 ? menuItems.length - 1 : (current - 1 + menuItems.length) % menuItems.length];
        target?.focus();
      }}
    >
      {items.map((item) => (
        <div key={item.id} className={item.separatorBefore === true ? 'ovl-context-menu__separated' : undefined}>
          <button
            type="button"
            role="menuitem"
            className={item.danger === true ? 'ovl-context-menu__danger' : undefined}
            aria-disabled={item.disabledReason === undefined ? undefined : true}
            title={item.disabledReason}
            onClick={() => {
              if (item.disabledReason !== undefined) return;
              if (closeOnSelect) onClose();
              item.action();
            }}
          >
            <Icon name={item.icon} size={14} />
            {item.detail === undefined ? (
              <span>{item.label}</span>
            ) : (
              <span className="ovl-context-menu__body">
                <span>{item.label}</span>
                <span className="ovl-context-menu__meta">{item.detail}</span>
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
