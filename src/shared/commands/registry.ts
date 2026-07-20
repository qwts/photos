export type CommandSurface = 'global' | 'grid' | 'lightbox' | 'dialog';
export type CommandPlatform = 'darwin' | 'win32' | 'linux';

export interface CommandContext {
  readonly surface: CommandSurface;
  readonly dialogOpen: boolean;
  readonly editable: boolean;
  readonly platform: CommandPlatform;
}

export interface CommandDescriptor {
  readonly id: string;
  readonly label: string;
  readonly surfaces: readonly CommandSurface[];
  readonly key: string;
  readonly primaryModifier?: boolean | undefined;
  readonly shift?: boolean | undefined;
}

export interface KeyboardLike {
  readonly key: string;
  readonly metaKey?: boolean | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
}

export const COMMANDS: readonly CommandDescriptor[] = [];

export function activeShortcuts(_context: CommandContext): readonly CommandDescriptor[] {
  return [];
}

export function findShortcutConflicts(_commands: readonly CommandDescriptor[]): readonly string[] {
  return [];
}

export function resolveCommand(_event: KeyboardLike, _context: CommandContext): CommandDescriptor | null {
  return null;
}

export function formatShortcut(_command: CommandDescriptor, _platform: CommandPlatform): string {
  return '';
}
