export type CommandSurface = 'global' | 'grid' | 'lightbox' | 'dialog';
export type CommandPlatform = 'darwin' | 'win32' | 'linux';
export type CommandTarget = 'application' | 'window' | 'route' | 'focused-item' | 'selection';
export type NativeMenu = 'app' | 'file' | 'edit' | 'view' | 'photo' | 'help';

export interface NativeCommandExposure {
  readonly menu: NativeMenu;
  readonly lockSafe: boolean;
  /** Only idempotent navigation commands may wait for a renderer document. */
  readonly queueable: boolean;
}

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
  readonly target: CommandTarget;
  readonly key?: string | undefined;
  readonly alternateKeys?: readonly string[] | undefined;
  readonly primaryModifier?: boolean | undefined;
  readonly shift?: boolean | undefined;
  readonly native?: NativeCommandExposure | undefined;
}

export type CommandId =
  | 'app.settings.open'
  | 'app.settings.open.storage'
  | 'app.settings.open.transfer'
  | 'app.settings.open.privacy'
  | 'app.lock.now'
  | 'app.search.focus'
  | 'library.switch'
  | 'library.import'
  | 'library.source.all'
  | 'library.source.favorites'
  | 'library.source.recent'
  | 'library.source.trash'
  | 'selection.selectAll'
  | 'selection.clear'
  | 'view.inspector.toggle'
  | 'view.mode.grid'
  | 'view.mode.list'
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
  {
    id: 'app.settings.open',
    label: label('app.settings.open', 'Settings…'),
    surfaces: ['global'],
    target: 'window',
    key: ',',
    primaryModifier: true,
    native: { menu: 'app', lockSafe: true, queueable: true },
  },
  {
    id: 'app.settings.open.storage',
    label: label('app.settings.open.storage', 'Storage & Backup'),
    surfaces: [],
    target: 'window',
    native: { menu: 'app', lockSafe: true, queueable: true },
  },
  {
    id: 'app.settings.open.transfer',
    label: label('app.settings.open.transfer', 'Transfer & Sync'),
    surfaces: [],
    target: 'window',
    native: { menu: 'app', lockSafe: true, queueable: true },
  },
  {
    id: 'app.settings.open.privacy',
    label: label('app.settings.open.privacy', 'Privacy & Diagnostics'),
    surfaces: [],
    target: 'window',
    native: { menu: 'app', lockSafe: true, queueable: true },
  },
  {
    id: 'app.lock.now',
    label: label('app.lock.now', 'Lock Now'),
    surfaces: [],
    target: 'application',
    native: { menu: 'app', lockSafe: false, queueable: false },
  },
  {
    id: 'app.search.focus',
    label: label('app.search.focus', 'Focus search'),
    surfaces: ['global', 'grid'],
    target: 'window',
    key: 'k',
    primaryModifier: true,
  },
  {
    id: 'library.switch',
    label: label('library.switch', 'Switch Library…'),
    surfaces: [],
    target: 'window',
    native: { menu: 'file', lockSafe: true, queueable: true },
  },
  {
    id: 'library.import',
    label: label('library.import', 'Import Photos…'),
    surfaces: [],
    target: 'window',
    native: { menu: 'file', lockSafe: false, queueable: true },
  },
  {
    id: 'library.source.all',
    label: label('library.source.all', 'All Photos'),
    surfaces: [],
    target: 'route',
    native: { menu: 'view', lockSafe: false, queueable: true },
  },
  {
    id: 'library.source.favorites',
    label: label('library.source.favorites', 'Favorites'),
    surfaces: [],
    target: 'route',
    native: { menu: 'view', lockSafe: false, queueable: true },
  },
  {
    id: 'library.source.recent',
    label: label('library.source.recent', 'Recent Imports'),
    surfaces: [],
    target: 'route',
    native: { menu: 'view', lockSafe: false, queueable: true },
  },
  {
    id: 'library.source.trash',
    label: label('library.source.trash', 'Trash'),
    surfaces: [],
    target: 'route',
    native: { menu: 'view', lockSafe: false, queueable: true },
  },
  {
    id: 'selection.selectAll',
    label: label('selection.selectAll', 'Select all photos'),
    surfaces: ['grid'],
    target: 'selection',
    key: 'a',
    primaryModifier: true,
    native: { menu: 'edit', lockSafe: false, queueable: false },
  },
  {
    id: 'selection.clear',
    label: label('selection.clear', 'Clear selection'),
    surfaces: ['global', 'grid'],
    target: 'selection',
    key: 'Escape',
  },
  {
    id: 'view.inspector.toggle',
    label: label('view.inspector.toggle', 'Show or hide Inspector'),
    surfaces: ['grid', 'lightbox'],
    target: 'window',
    key: 'i',
    native: { menu: 'view', lockSafe: false, queueable: false },
  },
  {
    id: 'view.mode.grid',
    label: label('view.mode.grid', 'Grid'),
    surfaces: [],
    target: 'window',
    native: { menu: 'view', lockSafe: false, queueable: true },
  },
  {
    id: 'view.mode.list',
    label: label('view.mode.list', 'List'),
    surfaces: [],
    target: 'window',
    native: { menu: 'view', lockSafe: false, queueable: true },
  },
  {
    id: 'view.lightbox.close',
    label: label('view.lightbox.close', 'Exit lightbox'),
    surfaces: ['lightbox'],
    target: 'window',
    key: 'Escape',
    native: { menu: 'view', lockSafe: false, queueable: false },
  },
  {
    id: 'view.lightbox.previous',
    label: label('view.lightbox.previous', 'Previous photo'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: 'ArrowLeft',
  },
  {
    id: 'view.lightbox.next',
    label: label('view.lightbox.next', 'Next photo'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: 'ArrowRight',
  },
  {
    id: 'photo.favorite.toggle',
    label: label('photo.favorite.toggle', 'Toggle favorite'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: 'f',
    native: { menu: 'photo', lockSafe: false, queueable: false },
  },
  {
    id: 'photo.trash',
    label: label('photo.trash', 'Move photo to Trash'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: 'Delete',
    native: { menu: 'photo', lockSafe: false, queueable: false },
  },
  {
    id: 'view.lightbox.zoomIn',
    label: label('view.lightbox.zoomIn', 'Zoom in'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: '+',
    alternateKeys: ['='],
  },
  {
    id: 'view.lightbox.zoomOut',
    label: label('view.lightbox.zoomOut', 'Zoom out'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: '-',
    alternateKeys: ['_'],
  },
  {
    id: 'view.lightbox.zoomReset',
    label: label('view.lightbox.zoomReset', 'Reset zoom'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: '0',
  },
  {
    id: 'view.lightbox.rotateLeft',
    label: label('view.lightbox.rotateLeft', 'Rotate left'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: '[',
  },
  {
    id: 'view.lightbox.rotateRight',
    label: label('view.lightbox.rotateRight', 'Rotate right'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: ']',
  },
  {
    id: 'view.lightbox.flipHorizontal',
    label: label('view.lightbox.flipHorizontal', 'Flip horizontally'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: '\\',
  },
  {
    id: 'view.lightbox.orientationReset',
    label: label('view.lightbox.orientationReset', 'Reset orientation'),
    surfaces: ['lightbox'],
    target: 'focused-item',
    key: 'r',
  },
  {
    id: 'help.shortcuts',
    label: label('help.shortcuts', 'Keyboard shortcuts'),
    surfaces: GLOBAL_SURFACES,
    target: 'window',
    key: '?',
    alternateKeys: ['/'],
    native: { menu: 'help', lockSafe: true, queueable: true },
  },
  {
    id: 'grid.focus.left',
    label: label('grid.focus.left', 'Move focus left'),
    surfaces: ['grid'],
    target: 'focused-item',
    key: 'ArrowLeft',
  },
  {
    id: 'grid.focus.right',
    label: label('grid.focus.right', 'Move focus right'),
    surfaces: ['grid'],
    target: 'focused-item',
    key: 'ArrowRight',
  },
  { id: 'grid.focus.up', label: label('grid.focus.up', 'Move focus up'), surfaces: ['grid'], target: 'focused-item', key: 'ArrowUp' },
  {
    id: 'grid.focus.down',
    label: label('grid.focus.down', 'Move focus down'),
    surfaces: ['grid'],
    target: 'focused-item',
    key: 'ArrowDown',
  },
  { id: 'grid.focus.home', label: label('grid.focus.home', 'Move to row start'), surfaces: ['grid'], target: 'focused-item', key: 'Home' },
  { id: 'grid.focus.end', label: label('grid.focus.end', 'Move to row end'), surfaces: ['grid'], target: 'focused-item', key: 'End' },
  {
    id: 'grid.focus.pageUp',
    label: label('grid.focus.pageUp', 'Move up one page'),
    surfaces: ['grid'],
    target: 'focused-item',
    key: 'PageUp',
  },
  {
    id: 'grid.focus.pageDown',
    label: label('grid.focus.pageDown', 'Move down one page'),
    surfaces: ['grid'],
    target: 'focused-item',
    key: 'PageDown',
  },
];

function normalizedKey(key: string): string {
  return key.length === 1 && key !== '?' ? key.toLocaleLowerCase('en-US') : key;
}

function primaryPressed(event: KeyboardLike, platform: CommandPlatform): boolean {
  return platform === 'darwin' ? event.metaKey === true : event.ctrlKey === true;
}

function matches(command: CommandDescriptor, event: KeyboardLike, platform: CommandPlatform): boolean {
  if (command.key === undefined) return false;
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
    if (command.key === undefined) continue;
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
  if (command.key === undefined) return '';
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

export function commandById(id: CommandId): CommandDescriptor {
  const command = COMMANDS.find((candidate) => candidate.id === id);
  if (command === undefined) throw new Error(`unknown command: ${id}`);
  return command;
}

export function nativeCommands(menu?: NativeMenu): readonly CommandDescriptor[] {
  return COMMANDS.filter((command) => command.native !== undefined && (menu === undefined || command.native.menu === menu));
}
