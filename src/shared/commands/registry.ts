export type CommandSurface = 'global' | 'grid' | 'lightbox' | 'dialog';
export type CommandPlatform = 'darwin' | 'win32' | 'linux';

export interface CommandContext {
  readonly surface: CommandSurface;
  readonly dialogOpen: boolean;
  readonly editable: boolean;
  readonly platform: CommandPlatform;
}

export interface CommandDescriptor {
  readonly id: CommandId;
  readonly label: { readonly id: string; readonly defaultMessage: string };
  readonly surfaces: readonly CommandSurface[];
  readonly key: string;
  readonly alternateKeys?: readonly string[] | undefined;
  readonly primaryModifier?: boolean | undefined;
  readonly shift?: boolean | undefined;
}

export type CommandId =
  | 'app.search.focus'
  | 'selection.selectAll'
  | 'selection.clear'
  | 'view.inspector.toggle'
  | 'view.lightbox.close'
  | 'view.lightbox.previous'
  | 'view.lightbox.next'
  | 'photo.favorite.toggle'
  | 'photo.trash'
  | 'view.lightbox.zoomIn'
  | 'view.lightbox.zoomOut'
  | 'view.lightbox.zoomReset'
  | 'view.lightbox.rotateLeft'
  | 'view.lightbox.rotateRight'
  | 'view.lightbox.flipHorizontal'
  | 'view.lightbox.orientationReset'
  | 'help.shortcuts'
  | 'grid.focus.left'
  | 'grid.focus.right'
  | 'grid.focus.up'
  | 'grid.focus.down'
  | 'grid.focus.home'
  | 'grid.focus.end'
  | 'grid.focus.pageUp'
  | 'grid.focus.pageDown';

export interface KeyboardLike {
  readonly key: string;
  readonly metaKey?: boolean | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
}

const GLOBAL_SURFACES: readonly CommandSurface[] = ['global', 'grid', 'lightbox'];
const label = (id: CommandId, defaultMessage: string): CommandDescriptor['label'] => ({ id: `commands.${id}`, defaultMessage });

export const COMMANDS: readonly CommandDescriptor[] = [
  { id: 'app.search.focus', label: label('app.search.focus', 'Focus search'), surfaces: GLOBAL_SURFACES, key: 'k', primaryModifier: true },
  {
    id: 'selection.selectAll',
    label: label('selection.selectAll', 'Select all photos'),
    surfaces: ['grid'],
    key: 'a',
    primaryModifier: true,
  },
  { id: 'selection.clear', label: label('selection.clear', 'Clear selection'), surfaces: ['global', 'grid'], key: 'Escape' },
  {
    id: 'view.inspector.toggle',
    label: label('view.inspector.toggle', 'Show or hide Inspector'),
    surfaces: ['grid', 'lightbox'],
    key: 'i',
  },
  { id: 'view.lightbox.close', label: label('view.lightbox.close', 'Exit lightbox'), surfaces: ['lightbox'], key: 'Escape' },
  { id: 'view.lightbox.previous', label: label('view.lightbox.previous', 'Previous photo'), surfaces: ['lightbox'], key: 'ArrowLeft' },
  { id: 'view.lightbox.next', label: label('view.lightbox.next', 'Next photo'), surfaces: ['lightbox'], key: 'ArrowRight' },
  { id: 'photo.favorite.toggle', label: label('photo.favorite.toggle', 'Toggle favorite'), surfaces: ['lightbox'], key: 'f' },
  { id: 'photo.trash', label: label('photo.trash', 'Move photo to Trash'), surfaces: ['lightbox'], key: 'Delete' },
  {
    id: 'view.lightbox.zoomIn',
    label: label('view.lightbox.zoomIn', 'Zoom in'),
    surfaces: ['lightbox'],
    key: '+',
    alternateKeys: ['='],
  },
  {
    id: 'view.lightbox.zoomOut',
    label: label('view.lightbox.zoomOut', 'Zoom out'),
    surfaces: ['lightbox'],
    key: '-',
    alternateKeys: ['_'],
  },
  { id: 'view.lightbox.zoomReset', label: label('view.lightbox.zoomReset', 'Reset zoom'), surfaces: ['lightbox'], key: '0' },
  { id: 'view.lightbox.rotateLeft', label: label('view.lightbox.rotateLeft', 'Rotate left'), surfaces: ['lightbox'], key: '[' },
  { id: 'view.lightbox.rotateRight', label: label('view.lightbox.rotateRight', 'Rotate right'), surfaces: ['lightbox'], key: ']' },
  {
    id: 'view.lightbox.flipHorizontal',
    label: label('view.lightbox.flipHorizontal', 'Flip horizontally'),
    surfaces: ['lightbox'],
    key: '\\',
  },
  {
    id: 'view.lightbox.orientationReset',
    label: label('view.lightbox.orientationReset', 'Reset orientation'),
    surfaces: ['lightbox'],
    key: 'r',
  },
  {
    id: 'help.shortcuts',
    label: label('help.shortcuts', 'Keyboard shortcuts'),
    surfaces: GLOBAL_SURFACES,
    key: '?',
    alternateKeys: ['/'],
  },
  { id: 'grid.focus.left', label: label('grid.focus.left', 'Move focus left'), surfaces: ['grid'], key: 'ArrowLeft' },
  { id: 'grid.focus.right', label: label('grid.focus.right', 'Move focus right'), surfaces: ['grid'], key: 'ArrowRight' },
  { id: 'grid.focus.up', label: label('grid.focus.up', 'Move focus up'), surfaces: ['grid'], key: 'ArrowUp' },
  { id: 'grid.focus.down', label: label('grid.focus.down', 'Move focus down'), surfaces: ['grid'], key: 'ArrowDown' },
  { id: 'grid.focus.home', label: label('grid.focus.home', 'Move to row start'), surfaces: ['grid'], key: 'Home' },
  { id: 'grid.focus.end', label: label('grid.focus.end', 'Move to row end'), surfaces: ['grid'], key: 'End' },
  { id: 'grid.focus.pageUp', label: label('grid.focus.pageUp', 'Move up one page'), surfaces: ['grid'], key: 'PageUp' },
  { id: 'grid.focus.pageDown', label: label('grid.focus.pageDown', 'Move down one page'), surfaces: ['grid'], key: 'PageDown' },
];

function normalizedKey(key: string): string {
  return key.length === 1 && key !== '?' ? key.toLocaleLowerCase('en-US') : key;
}

function primaryPressed(event: KeyboardLike, platform: CommandPlatform): boolean {
  return platform === 'darwin' ? event.metaKey === true : event.ctrlKey === true;
}

function matches(command: CommandDescriptor, event: KeyboardLike, platform: CommandPlatform): boolean {
  const keys = [command.key, ...(command.alternateKeys ?? [])];
  if (!keys.some((key) => normalizedKey(event.key) === normalizedKey(key))) return false;
  if (primaryPressed(event, platform) !== (command.primaryModifier === true)) return false;
  const printableSymbol = event.key.length === 1 && !/[a-z0-9]/iu.test(event.key);
  if (!printableSymbol && (event.shiftKey === true) !== (command.shift === true)) return false;
  if (event.altKey === true) return false;
  if (platform === 'darwin' ? event.ctrlKey === true : event.metaKey === true) return false;
  return true;
}

export function activeShortcuts(context: CommandContext): readonly CommandDescriptor[] {
  if (context.dialogOpen || context.editable || context.surface === 'dialog') return [];
  return COMMANDS.filter((command) => command.surfaces.includes(context.surface));
}

export function findShortcutConflicts(commands: readonly CommandDescriptor[]): readonly string[] {
  const seen = new Map<string, CommandId>();
  const conflicts: string[] = [];
  for (const command of commands) {
    for (const surface of command.surfaces) {
      for (const key of [command.key, ...(command.alternateKeys ?? [])]) {
        const binding = `${surface}:${command.primaryModifier === true ? 'primary+' : ''}${command.shift === true ? 'shift+' : ''}${normalizedKey(key)}`;
        const prior = seen.get(binding);
        if (prior === undefined) seen.set(binding, command.id);
        else conflicts.push(`${binding}: ${prior}, ${command.id}`);
      }
    }
  }
  return conflicts;
}

export function resolveCommand(event: KeyboardLike, context: CommandContext): CommandDescriptor | null {
  return activeShortcuts(context).find((command) => matches(command, event, context.platform)) ?? null;
}

export function formatShortcut(command: CommandDescriptor, platform: CommandPlatform): string {
  const parts: string[] = [];
  if (command.primaryModifier === true) parts.push(platform === 'darwin' ? '⌘' : 'Ctrl+');
  if (command.shift === true) parts.push(platform === 'darwin' ? '⇧' : 'Shift+');
  const display =
    command.key === 'ArrowLeft'
      ? '←'
      : command.key === 'ArrowRight'
        ? '→'
        : command.key === 'ArrowUp'
          ? '↑'
          : command.key === 'ArrowDown'
            ? '↓'
            : command.key.length === 1
              ? command.key.toLocaleUpperCase('en-US')
              : command.key;
  parts.push(display);
  return parts.join('');
}
