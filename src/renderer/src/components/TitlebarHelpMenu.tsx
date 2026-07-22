import { useRef, useState, type ReactElement } from 'react';
import { useIntl } from 'react-intl';

import { commandById, type CommandId } from '../../../shared/commands/registry.js';
import { HELP_MENU_ITEMS } from '../../../shared/commands/help-menu.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { Icon, type IconName } from './Icon';
import './titlebar.css';

// The Help glyphs mirror the macOS Help menu's intent; labels/order/shortcuts
// come from the shared registry list, so only the icon mapping lives here.
const ICON_BY_COMMAND: Partial<Record<CommandId, IconName>> = {
  'help.shortcuts': 'keyboard',
  'help.activity': 'database',
  'app.settings.open.privacy': 'shield-check',
  'help.open': 'circle-help',
};

export interface TitlebarHelpMenuProps {
  /** process.platform. The affordance is Windows/Linux only — macOS keeps its
   *  native Help menu, so this renders nothing there (ADR-0024 §5, I2). */
  readonly platform: string;
  /** Dispatches the selected registry command — the same id and handler the
   *  macOS Help menu uses, so the two Help surfaces stay in parity (I1). */
  readonly onCommand: (command: CommandId) => void;
}

// components/core/TitlebarHelpMenu — Windows/Linux titlebar Help affordance. A
// no-drag `help-circle` button, left of the window controls, that opens the
// shared APG `ContextMenu` populated from HELP_MENU_ITEMS. macOS is unchanged.
export function TitlebarHelpMenu({ platform, onCommand }: TitlebarHelpMenuProps): ReactElement | null {
  const intl = useIntl();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number; readonly focus: 'first' | 'last' } | null>(null);

  if (platform === 'darwin') return null;

  const helpLabel = intl.formatMessage({ id: 'titlebar.help', defaultMessage: 'Help' });

  const open = (focus: 'first' | 'last'): void => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    // Anchor bottom-right of the button; ContextMenu clamps into the viewport,
    // which right-aligns it against the near window edge (bottom-left in RTL).
    setMenu({ x: rect.right, y: rect.bottom, focus });
  };
  // Every dismissal (select, Esc, outside pointer) routes here so focus never
  // drops to <body> — it returns to the button before any command runs.
  const close = (): void => {
    setMenu(null);
    buttonRef.current?.focus();
  };

  const items: ContextMenuItem[] = HELP_MENU_ITEMS.map((entry) => {
    const command = commandById(entry.command);
    return {
      id: entry.menuItemId ?? entry.command,
      label: intl.formatMessage(command.label),
      icon: ICON_BY_COMMAND[entry.command] ?? 'circle-help',
      hint: command.key === '?' ? '?' : undefined,
      action: () => onCommand(entry.command),
      separatorBefore: entry.separatorBefore,
    };
  });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ovl-titlebar__button ovl-titlebar__help"
        aria-label={helpLabel}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        // Keep the button's own pointerdown from reaching ContextMenu's
        // document close listener, so a second click toggles it shut cleanly.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => (menu === null ? open('first') : close())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            open('first');
          } else if (event.key === 'ArrowUp' || event.key === 'End') {
            event.preventDefault();
            open('last');
          }
        }}
      >
        <Icon name="circle-help" size={16} />
      </button>
      {menu === null ? null : (
        <ContextMenu label={helpLabel} x={menu.x} y={menu.y} items={items} initialFocus={menu.focus} onClose={close} />
      )}
    </>
  );
}
