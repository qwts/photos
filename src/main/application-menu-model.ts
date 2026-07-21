import type { MenuItemConstructorOptions } from 'electron';

import { commandById, type CommandDescriptor, type CommandId, type CommandPlatform } from '../shared/commands/registry.js';
import type { CommandMenuContext } from '../shared/commands/menu-contract.js';

export type CommandDispatch = (id: CommandId) => void;
export interface MessageDescriptor {
  readonly id: string;
  readonly defaultMessage: string;
}
export type MenuTranslate = (message: MessageDescriptor) => string;

const defineMessages = <T extends Record<string, MessageDescriptor>>(messages: T): T => messages;

const menuMessages = defineMessages({
  settingsSections: { id: 'menu.settingsSections', defaultMessage: 'Settings Sections' },
  file: { id: 'menu.file', defaultMessage: 'File' },
  edit: { id: 'menu.edit', defaultMessage: 'Edit' },
  view: { id: 'menu.view', defaultMessage: 'View' },
  photo: { id: 'menu.photo', defaultMessage: 'Photo' },
  window: { id: 'menu.window', defaultMessage: 'Window' },
});

const sourceText: MenuTranslate = ({ defaultMessage }) => (typeof defaultMessage === 'string' ? defaultMessage : '');

function locked(context: CommandMenuContext): boolean {
  return context.surface === 'locked';
}

export function commandEnabled(id: CommandId, context: CommandMenuContext): boolean {
  if (locked(context) && commandById(id).native?.lockSafe !== true) return false;
  switch (id) {
    case 'app.settings.open':
    case 'app.settings.open.storage':
    case 'app.settings.open.transfer':
    case 'app.settings.open.privacy':
    case 'library.switch':
    case 'help.shortcuts':
    case 'help.open':
      return true;
    case 'app.lock.now':
      return context.appLockConfigured && !locked(context);
    case 'library.import':
      return context.hasLibrary && !context.providerBusy && !locked(context);
    case 'library.source.all':
    case 'library.source.favorites':
    case 'library.source.recent':
    case 'library.source.trash':
      return context.hasLibrary && !locked(context);
    case 'selection.selectAll':
      return context.surface === 'grid' && context.dialog === 'none' && !context.editable && context.hasPhotos;
    case 'view.inspector.toggle':
      return (context.surface === 'grid' || context.surface === 'lightbox') && context.dialog === 'none';
    case 'view.mode.grid':
    case 'view.mode.list':
      return context.surface === 'grid' && context.dialog === 'none';
    case 'view.lightbox.close':
      return context.surface === 'lightbox' && context.dialog === 'none';
    case 'photo.favorite.toggle':
      return context.surface === 'lightbox' && context.dialog === 'none' && context.hasTarget;
    case 'photo.trash':
      return context.surface === 'lightbox' && context.dialog === 'none' && context.targetTrashable;
    case 'app.search.focus':
    case 'selection.clear':
    case 'view.lightbox.previous':
    case 'view.lightbox.next':
    case 'view.lightbox.zoomIn':
    case 'view.lightbox.zoomOut':
    case 'view.lightbox.zoomReset':
    case 'view.lightbox.rotateLeft':
    case 'view.lightbox.rotateRight':
    case 'view.lightbox.flipHorizontal':
    case 'view.lightbox.orientationReset':
    case 'grid.focus.left':
    case 'grid.focus.right':
    case 'grid.focus.up':
    case 'grid.focus.down':
    case 'grid.focus.home':
    case 'grid.focus.end':
    case 'grid.focus.pageUp':
    case 'grid.focus.pageDown':
      return false;
  }
}

function accelerator(command: CommandDescriptor): string | undefined {
  if (command.key === undefined) return undefined;
  const parts: string[] = [];
  if (command.primaryModifier === true) parts.push('CommandOrControl');
  if (command.shift === true || command.key === '?') parts.push('Shift');
  const key = command.key === '?' ? '/' : command.key === 'Escape' ? 'Esc' : command.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

function commandItem(
  id: CommandId,
  context: CommandMenuContext,
  dispatch: CommandDispatch,
  translate: MenuTranslate,
  options: Pick<MenuItemConstructorOptions, 'type' | 'checked'> = {},
): MenuItemConstructorOptions {
  const command = commandById(id);
  const shortcut = accelerator(command);
  return {
    id,
    label: translate(command.label),
    enabled: commandEnabled(id, context),
    ...(shortcut === undefined ? {} : { accelerator: shortcut }),
    ...options,
    click: () => dispatch(id),
  };
}

function settingsItems(context: CommandMenuContext, dispatch: CommandDispatch, translate: MenuTranslate): MenuItemConstructorOptions[] {
  return [
    commandItem('app.settings.open', context, dispatch, translate),
    {
      label: translate(menuMessages.settingsSections),
      submenu: [
        commandItem('app.settings.open.storage', context, dispatch, translate),
        commandItem('app.settings.open.transfer', context, dispatch, translate),
        commandItem('app.settings.open.privacy', context, dispatch, translate),
      ],
    },
    ...(context.appLockConfigured ? [commandItem('app.lock.now', context, dispatch, translate)] : []),
  ];
}

export function buildApplicationMenuTemplate(
  platform: CommandPlatform,
  appName: string,
  context: CommandMenuContext,
  dispatch: CommandDispatch,
  translate: MenuTranslate = sourceText,
): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions[] =
    platform === 'darwin'
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              ...settingsItems(context, dispatch, translate),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : [];
  const fileSettings = platform === 'darwin' ? [] : [...settingsItems(context, dispatch, translate), { type: 'separator' as const }];

  return [
    ...appMenu,
    {
      label: translate(menuMessages.file),
      submenu: [
        ...fileSettings,
        commandItem('library.import', context, dispatch, translate),
        commandItem('library.switch', context, dispatch, translate),
        ...(platform === 'darwin' ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: translate(menuMessages.edit),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        context.editable ? { role: 'selectAll' } : commandItem('selection.selectAll', context, dispatch, translate),
      ],
    },
    {
      label: translate(menuMessages.view),
      submenu: [
        commandItem('library.source.all', context, dispatch, translate, { type: 'radio', checked: context.source === 'all' }),
        commandItem('library.source.favorites', context, dispatch, translate, { type: 'radio', checked: context.source === 'favorites' }),
        commandItem('library.source.recent', context, dispatch, translate, { type: 'radio', checked: context.source === 'recent' }),
        commandItem('library.source.trash', context, dispatch, translate, { type: 'radio', checked: context.source === 'deleted' }),
        { type: 'separator' },
        commandItem('view.inspector.toggle', context, dispatch, translate, { type: 'checkbox', checked: context.inspectorOpen }),
        commandItem('view.mode.grid', context, dispatch, translate, { type: 'radio', checked: context.view === 'grid' }),
        commandItem('view.mode.list', context, dispatch, translate, { type: 'radio', checked: context.view === 'list' }),
        { type: 'separator' },
        commandItem('view.lightbox.close', context, dispatch, translate),
      ],
    },
    {
      label: translate(menuMessages.photo),
      submenu: [
        commandItem('photo.favorite.toggle', context, dispatch, translate),
        commandItem('photo.trash', context, dispatch, translate),
      ],
    },
    {
      label: translate(menuMessages.window),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
      ],
    },
    {
      role: 'help',
      submenu: [
        commandItem('help.shortcuts', context, dispatch, translate),
        commandItem('help.open', context, dispatch, translate),
        { ...commandItem('app.settings.open.privacy', context, dispatch, translate), id: 'help.privacy' },
      ],
    },
  ];
}
