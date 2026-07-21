import type { CommandDraft } from '../activity/activity-publication.js';

export function favoriteCommand(photoId: string, favorite: boolean): CommandDraft {
  return {
    commandId: 'photo.favorite.toggle',
    classification: 'immediately-reversible',
    inverse: { kind: 'favorite', photoId, before: !favorite, after: favorite },
  };
}

export function trashCommand(photoIds: readonly string[], operation: 'trash' | 'restore'): CommandDraft | undefined {
  if (photoIds.length === 0) return undefined;
  return {
    commandId: operation === 'trash' ? 'photo.trash' : 'photo.restore',
    classification: 'conditionally-reversible',
    inverse: {
      kind: 'trash',
      photoIds,
      before: operation === 'trash' ? 'live' : 'trashed',
      after: operation === 'trash' ? 'trashed' : 'live',
    },
  };
}

export function albumMembershipCommand(
  albumId: string,
  photoIds: readonly string[],
  operation: 'add' | 'remove',
): CommandDraft | undefined {
  if (photoIds.length === 0) return undefined;
  return {
    commandId: operation === 'add' ? 'album.membership.add' : 'album.membership.remove',
    classification: 'immediately-reversible',
    inverse: {
      kind: 'album-membership',
      albumId,
      photoIds,
      before: operation === 'add' ? 'absent' : 'present',
      after: operation === 'add' ? 'present' : 'absent',
    },
  };
}
