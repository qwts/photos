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

/** A deterministic photo target: the focused lightbox photo or an intentional selection. */
function hasPhotoTarget(context: CommandMenuContext): boolean {
  return (context.surface === 'lightbox' && context.hasTarget) || context.selectionCount > 0;
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
    case 'history.undo':
    case 'history.redo':
      return context.hasLibrary && context.dialog === 'none' && !context.editable;
    case 'help.activity':
      // Activity is per-library and unavailable while locked (the lock guard
      // above handles locked); available from any surface with a library.
      return context.hasLibrary;
    case 'view.inspector.toggle':
    case 'view.inspector.detach':
      return (context.surface === 'grid' || context.surface === 'lightbox') && context.dialog === 'none';
    case 'view.mode.grid':
    case 'view.mode.list':
    case 'view.mode.moodboard':
      return context.surface === 'grid' && context.dialog === 'none';
    case 'view.lightbox.close':
      return context.surface === 'lightbox' && context.dialog === 'none';
    case 'photo.original.mark':
    case 'photo.original.unmark':
      return context.surface === 'lightbox' && context.dialog === 'none' && context.targetTrashable;
    // #689 Photo menu — target-aware (focused lightbox photo or intentional
    // selection), never on Trash rows; the executing adapter revalidates.
    case 'photo.favorite.toggle':
      return context.dialog === 'none' && context.source !== 'deleted' && hasPhotoTarget(context);
    case 'photo.trash':
      // The focused lightbox photo must be trashable; a grid selection is
      // trashable when the route is not already Trash. The adapter revalidates.
      return (
        context.dialog === 'none' &&
        ((context.surface === 'lightbox' && context.hasTarget && context.targetTrashable) ||
          (context.surface !== 'lightbox' && context.source !== 'deleted' && context.selectionCount > 0))
      );
    case 'photo.export':
      return context.dialog === 'none' && hasPhotoTarget(context);
    case 'album.membership.add':
      return context.dialog === 'none' && context.source !== 'deleted' && context.hasLibrary && hasPhotoTarget(context);
    case 'album.membership.remove':
      return context.dialog === 'none' && context.inAlbum && hasPhotoTarget(context);
    case 'photo.restore':
      return context.dialog === 'none' && context.source === 'deleted' && hasPhotoTarget(context);
    // #689 File/Edit/View additions wired to their handlers.
    case 'library.move':
      return context.hasLibrary && context.dialog === 'none';
    case 'library.new':
      return context.dialog === 'none';
    case 'view.sidebar.toggle':
      return (context.surface === 'grid' || context.surface === 'lightbox') && context.dialog === 'none';
    case 'selection.clear':
      return context.surface === 'grid' && context.dialog === 'none' && !context.editable && context.selectionCount > 0;
    // Feed view has not landed yet (#689) — the item stays disabled.
    case 'view.mode.feed':
      return false;
    case 'album.rename':
    case 'album.delete':
    case 'album.transfer':
    case 'album.reorder.up':
    case 'album.reorder.down':
    case 'album.reorder.top':
    case 'album.reorder.bottom':
    case 'board.layout':
    case 'photo.open':
    case 'photo.offload':
    case 'photo.restoreOriginal':
    case 'photo.transfer':
    case 'photo.purge':
    case 'trash.empty':
      return false;
    case 'app.search.focus':
    case 'view.lightbox.previous':
    case 'view.lightbox.next':
    case 'view.lightbox.zoomIn':
    case 'view.lightbox.zoomOut':
    case 'view.lightbox.zoomReset':
    case 'view.lightbox.rotateLeft':
    case 'view.lightbox.rotateRight':
    case 'view.lightbox.flipHorizontal':
    case 'view.lightbox.flipVertical':
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

const separator: MenuItemConstructorOptions = { type: 'separator' };

/** Drop a menu item's accelerator without changing its command dispatch. */
function withoutAccelerator(item: MenuItemConstructorOptions): MenuItemConstructorOptions {
  const { accelerator: _accelerator, ...rest } = item;
  return rest;
}

/** Re-project a command into a second menu slot: distinct item id, no accelerator, same command dispatch. */
function alias(item: MenuItemConstructorOptions, id: string): MenuItemConstructorOptions {
  return { ...withoutAccelerator(item), id };
}

/**
 * macOS application menu (#689) — projects the design-system `MenuBar` spec:
 * Overlook · File · Edit · View · Photo · Help, in this exact order, every
 * item dispatching a shared-registry command id (ADR-0024 parity). Cut/Copy/
 * Paste and About/Quit are OS roles the design mock cannot render but ADR-0024
 * §1 mandates and text editing requires. The Help → Activity item is owned by
 * #690 (`help.activity`) and is inserted there.
 */
function macApplicationMenuTemplate(
  appName: string,
  context: CommandMenuContext,
  dispatch: CommandDispatch,
  translate: MenuTranslate,
): MenuItemConstructorOptions[] {
  const inTrash = context.source === 'deleted';
  const photoItems: MenuItemConstructorOptions[] = inTrash
    ? [commandItem('photo.restore', context, dispatch, translate)]
    : [
        commandItem('photo.favorite.toggle', context, dispatch, translate),
        commandItem('album.membership.add', context, dispatch, translate),
        ...(context.inAlbum ? [commandItem('album.membership.remove', context, dispatch, translate)] : []),
        // Same `photo.export` command as File → Export Selection…; distinct
        // menu-item id + no accelerator (the ⇧⌘E shortcut lives on the File item).
        alias(commandItem('photo.export', context, dispatch, translate), 'photo.export.photo'),
        separator,
        commandItem('photo.trash', context, dispatch, translate),
      ];

  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        separator,
        commandItem('app.settings.open', context, dispatch, translate),
        commandItem('app.settings.open.storage', context, dispatch, translate),
        commandItem('app.settings.open.transfer', context, dispatch, translate),
        commandItem('app.settings.open.privacy', context, dispatch, translate),
        separator,
        commandItem('app.lock.now', context, dispatch, translate),
        separator,
        { role: 'quit' },
      ],
    },
    {
      label: translate(menuMessages.file),
      submenu: [
        commandItem('library.import', context, dispatch, translate),
        commandItem('photo.export', context, dispatch, translate),
        separator,
        commandItem('library.switch', context, dispatch, translate),
        commandItem('library.move', context, dispatch, translate),
        commandItem('library.new', context, dispatch, translate),
      ],
    },
    {
      label: translate(menuMessages.edit),
      submenu: [
        commandItem('history.undo', context, dispatch, translate),
        commandItem('history.redo', context, dispatch, translate),
        separator,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        separator,
        context.editable ? { role: 'selectAll' } : commandItem('selection.selectAll', context, dispatch, translate),
        commandItem('selection.clear', context, dispatch, translate),
      ],
    },
    {
      label: translate(menuMessages.view),
      submenu: [
        commandItem('library.source.all', context, dispatch, translate, { type: 'radio', checked: context.source === 'all' }),
        commandItem('library.source.favorites', context, dispatch, translate, { type: 'radio', checked: context.source === 'favorites' }),
        commandItem('library.source.recent', context, dispatch, translate, { type: 'radio', checked: context.source === 'recent' }),
        commandItem('library.source.trash', context, dispatch, translate, { type: 'radio', checked: context.source === 'deleted' }),
        separator,
        commandItem('view.mode.grid', context, dispatch, translate, { type: 'radio', checked: context.view === 'grid' }),
        commandItem('view.mode.list', context, dispatch, translate, { type: 'radio', checked: context.view === 'list' }),
        commandItem('view.mode.feed', context, dispatch, translate, { type: 'radio', checked: false }),
        commandItem('view.mode.moodboard', context, dispatch, translate, { type: 'radio', checked: context.view === 'moodboard' }),
        separator,
        commandItem('view.inspector.toggle', context, dispatch, translate, { type: 'checkbox', checked: context.inspectorOpen }),
        commandItem('view.inspector.detach', context, dispatch, translate),
        commandItem('view.sidebar.toggle', context, dispatch, translate),
      ],
    },
    {
      label: translate(menuMessages.photo),
      submenu: photoItems,
    },
    {
      role: 'help',
      submenu: [
        commandItem('help.shortcuts', context, dispatch, translate),
        commandItem('help.activity', context, dispatch, translate),
        separator,
        { ...commandItem('app.settings.open.privacy', context, dispatch, translate), id: 'help.privacy' },
        commandItem('help.open', context, dispatch, translate),
      ],
    },
  ];
}

/**
 * Windows/Linux menu — unchanged from the #531 baseline (ADR-0024 §5). The
 * design system only specs the macOS bar; removing the non-mac menu is tracked
 * separately (needs an ADR-0024 amendment) and is out of scope for #689.
 */
function otherApplicationMenuTemplate(
  platform: CommandPlatform,
  context: CommandMenuContext,
  dispatch: CommandDispatch,
  translate: MenuTranslate,
): MenuItemConstructorOptions[] {
  return [
    {
      label: translate(menuMessages.file),
      submenu: [
        ...settingsItems(context, dispatch, translate),
        separator,
        // #689 scopes the ⌘I accelerator to the macOS bar; keep the Windows/
        // Linux Import item accelerator-free so those menus stay unchanged.
        withoutAccelerator(commandItem('library.import', context, dispatch, translate)),
        commandItem('library.switch', context, dispatch, translate),
        separator,
        { role: 'quit' },
      ],
    },
    {
      label: translate(menuMessages.edit),
      submenu: [
        commandItem('history.undo', context, dispatch, translate),
        commandItem('history.redo', context, dispatch, translate),
        separator,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        separator,
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
        separator,
        commandItem('view.inspector.toggle', context, dispatch, translate, { type: 'checkbox', checked: context.inspectorOpen }),
        commandItem('view.inspector.detach', context, dispatch, translate),
        commandItem('view.mode.grid', context, dispatch, translate, { type: 'radio', checked: context.view === 'grid' }),
        commandItem('view.mode.list', context, dispatch, translate, { type: 'radio', checked: context.view === 'list' }),
        commandItem('view.mode.moodboard', context, dispatch, translate, { type: 'radio', checked: context.view === 'moodboard' }),
        separator,
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
        commandItem('help.activity', context, dispatch, translate),
        commandItem('help.open', context, dispatch, translate),
        { ...commandItem('app.settings.open.privacy', context, dispatch, translate), id: 'help.privacy' },
      ],
    },
  ];
}

export function buildApplicationMenuTemplate(
  platform: CommandPlatform,
  appName: string,
  context: CommandMenuContext,
  dispatch: CommandDispatch,
  translate: MenuTranslate = sourceText,
): MenuItemConstructorOptions[] {
  if (platform === 'darwin') return macApplicationMenuTemplate(appName, context, dispatch, translate);
  return otherApplicationMenuTemplate(platform, context, dispatch, translate);
}
