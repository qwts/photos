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
  | 'help.open'
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
const defineMessages = <T extends Record<string, CommandDescriptor['label']>>(messages: T): T => messages;
const commandLabels: Record<CommandId, CommandDescriptor['label']> = defineMessages({
  'app.settings.open': { id: 'commands.app.settings.open', defaultMessage: 'Settings…' },
  'app.settings.open.storage': { id: 'commands.app.settings.open.storage', defaultMessage: 'Storage & Backup' },
  'app.settings.open.transfer': { id: 'commands.app.settings.open.transfer', defaultMessage: 'Transfer & Sync' },
  'app.settings.open.privacy': { id: 'commands.app.settings.open.privacy', defaultMessage: 'Privacy & Diagnostics' },
  'app.lock.now': { id: 'commands.app.lock.now', defaultMessage: 'Lock Now' },
  'app.search.focus': { id: 'commands.app.search.focus', defaultMessage: 'Focus search' },
  'library.switch': { id: 'commands.library.switch', defaultMessage: 'Switch Library…' },
  'library.import': { id: 'commands.library.import', defaultMessage: 'Import Photos…' },
  'library.source.all': { id: 'commands.library.source.all', defaultMessage: 'All Photos' },
  'library.source.favorites': { id: 'commands.library.source.favorites', defaultMessage: 'Favorites' },
  'library.source.recent': { id: 'commands.library.source.recent', defaultMessage: 'Recent Imports' },
  'library.source.trash': { id: 'commands.library.source.trash', defaultMessage: 'Trash' },
  'selection.selectAll': { id: 'commands.selection.selectAll', defaultMessage: 'Select all photos' },
  'selection.clear': { id: 'commands.selection.clear', defaultMessage: 'Clear selection' },
  'view.inspector.toggle': { id: 'commands.view.inspector.toggle', defaultMessage: 'Show or hide Inspector' },
  'view.mode.grid': { id: 'commands.view.mode.grid', defaultMessage: 'Grid' },
  'view.mode.list': { id: 'commands.view.mode.list', defaultMessage: 'List' },
  'view.lightbox.close': { id: 'commands.view.lightbox.close', defaultMessage: 'Exit lightbox' },
  'view.lightbox.previous': { id: 'commands.view.lightbox.previous', defaultMessage: 'Previous photo' },
  'view.lightbox.next': { id: 'commands.view.lightbox.next', defaultMessage: 'Next photo' },
  'photo.favorite.toggle': { id: 'commands.photo.favorite.toggle', defaultMessage: 'Toggle favorite' },
  'photo.trash': { id: 'commands.photo.trash', defaultMessage: 'Move photo to Trash' },
  'view.lightbox.zoomIn': { id: 'commands.view.lightbox.zoomIn', defaultMessage: 'Zoom in' },
  'view.lightbox.zoomOut': { id: 'commands.view.lightbox.zoomOut', defaultMessage: 'Zoom out' },
  'view.lightbox.zoomReset': { id: 'commands.view.lightbox.zoomReset', defaultMessage: 'Reset zoom' },
  'view.lightbox.rotateLeft': { id: 'commands.view.lightbox.rotateLeft', defaultMessage: 'Rotate left' },
  'view.lightbox.rotateRight': { id: 'commands.view.lightbox.rotateRight', defaultMessage: 'Rotate right' },
  'view.lightbox.flipHorizontal': { id: 'commands.view.lightbox.flipHorizontal', defaultMessage: 'Flip horizontally' },
  'view.lightbox.orientationReset': { id: 'commands.view.lightbox.orientationReset', defaultMessage: 'Reset orientation' },
  'help.shortcuts': { id: 'commands.help.shortcuts', defaultMessage: 'Keyboard shortcuts' },
  'help.open': { id: 'commands.help.open', defaultMessage: 'Overlook Help' },
  'grid.focus.left': { id: 'commands.grid.focus.left', defaultMessage: 'Move focus left' },
  'grid.focus.right': { id: 'commands.grid.focus.right', defaultMessage: 'Move focus right' },
  'grid.focus.up': { id: 'commands.grid.focus.up', defaultMessage: 'Move focus up' },
  'grid.focus.down': { id: 'commands.grid.focus.down', defaultMessage: 'Move focus down' },
  'grid.focus.home': { id: 'commands.grid.focus.home', defaultMessage: 'Move to row start' },
  'grid.focus.end': { id: 'commands.grid.focus.end', defaultMessage: 'Move to row end' },
  'grid.focus.pageUp': { id: 'commands.grid.focus.pageUp', defaultMessage: 'Move up one page' },
  'grid.focus.pageDown': { id: 'commands.grid.focus.pageDown', defaultMessage: 'Move down one page' },
});

const label = (id: CommandId, _defaultMessage: string): CommandDescriptor['label'] => commandLabels[id];

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
    id: 'help.open',
    label: label('help.open', 'Overlook Help'),
    surfaces: [],
    target: 'application',
    native: { menu: 'help', lockSafe: true, queueable: false },
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
