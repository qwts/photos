import { useEffect, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';

import { useFormats } from '../i18n/use-formats.js';
import type { AlbumSummary } from '../../../shared/library/types.js';
import type { PhotoDragPayload } from '../../../shared/library/photo-drag.js';
import type { AppAction } from '../../../shared/library/app-state.js';
import { endPhotoDrag, hasPhotoDrag, readPhotoDrag } from '../grid/photo-drag-session';
import { useAppDispatch } from '../state/app-state-context';

export type AlbumDropPhase = 'allowed' | 'no-op' | 'pending' | 'success';

export interface AlbumDropFeedback {
  readonly albumId: string;
  readonly phase: AlbumDropPhase;
  readonly label: string;
}

export interface AlbumDropChoice {
  readonly payload: PhotoDragPayload;
  readonly source: AlbumSummary;
  readonly target: AlbumSummary;
}

interface AlbumDropTargetProps {
  readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

function noun(count: number): string {
  return count === 1 ? 'photo' : 'photos';
}

interface DropEffects {
  readonly formatCount: (value: number) => string;
  readonly dispatch: Dispatch<AppAction>;
  readonly setFeedback: Dispatch<SetStateAction<AlbumDropFeedback | null>>;
  readonly showTemporary: (feedback: AlbumDropFeedback) => void;
}

function addPhotos(payload: PhotoDragPayload, target: AlbumSummary, effects: DropEffects): void {
  const { formatCount } = effects;
  effects.setFeedback({ albumId: target.id, phase: 'pending', label: 'Adding…' });
  void window.overlook.albums
    .addPhotos({ albumId: target.id, photoIds: [...payload.photoIds] })
    .then(({ added }) => {
      const duplicates = payload.photoIds.length - added;
      if (added === 0) {
        effects.showTemporary({ albumId: target.id, phase: 'no-op', label: 'Already here' });
        effects.dispatch({
          type: 'toast/shown',
          toast: { title: `${formatCount(duplicates)} ${noun(duplicates)} already in ${target.name} · no changes`, tone: 'neutral' },
        });
        return;
      }
      effects.showTemporary({ albumId: target.id, phase: 'success', label: 'Added' });
      effects.dispatch({
        type: 'toast/shown',
        toast: {
          title:
            duplicates === 0
              ? `Added ${formatCount(added)} ${noun(added)} to ${target.name}`
              : `Added ${formatCount(added)} ${noun(added)} to ${target.name} · ${formatCount(duplicates)} already there`,
          tone: 'green',
        },
      });
    })
    .catch(() => {
      effects.setFeedback(null);
      effects.dispatch({ type: 'toast/shown', toast: { title: `Could not add photos to ${target.name}`, tone: 'amber' } });
    });
}

function movePhotos(current: AlbumDropChoice, effects: DropEffects): void {
  const { formatCount } = effects;
  effects.setFeedback({ albumId: current.target.id, phase: 'pending', label: 'Moving…' });
  void window.overlook.albums
    .movePhotos({
      sourceAlbumId: current.source.id,
      targetAlbumId: current.target.id,
      photoIds: [...current.payload.photoIds],
    })
    .then(({ moved, alreadyInTarget }) => {
      if (moved === 0) {
        effects.showTemporary({ albumId: current.target.id, phase: 'no-op', label: 'No changes' });
        effects.dispatch({ type: 'toast/shown', toast: { title: `No photos moved to ${current.target.name}`, tone: 'neutral' } });
        return;
      }
      effects.showTemporary({ albumId: current.target.id, phase: 'success', label: 'Moved' });
      effects.dispatch({
        type: 'toast/shown',
        toast: {
          title:
            alreadyInTarget === 0
              ? `Moved ${formatCount(moved)} ${noun(moved)} to ${current.target.name}`
              : `Moved ${formatCount(moved)} ${noun(moved)} to ${current.target.name} · ${formatCount(alreadyInTarget)} already there`,
          tone: 'green',
        },
      });
    })
    .catch(() => {
      effects.setFeedback(null);
      effects.dispatch({
        type: 'toast/shown',
        toast: { title: `Could not move photos to ${current.target.name} · source unchanged`, tone: 'amber' },
      });
    });
}

interface DropTargetContext extends DropEffects {
  readonly albums: readonly AlbumSummary[];
  readonly feedback: AlbumDropFeedback | null;
  readonly setChoice: Dispatch<SetStateAction<AlbumDropChoice | null>>;
}

function targetPropsFor(target: AlbumSummary, context: DropTargetContext): AlbumDropTargetProps {
  const { formatCount } = context;
  const accept = (event: DragEvent<HTMLElement>): PhotoDragPayload | null => {
    if (!hasPhotoDrag(event.dataTransfer)) return null;
    const payload = readPhotoDrag(event.dataTransfer);
    if (payload === null) return null;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    return payload;
  };
  return {
    onDragEnter: (event) => {
      const payload = accept(event);
      if (payload === null) return;
      context.setFeedback({
        albumId: target.id,
        phase: payload.sourceAlbumId === target.id ? 'no-op' : 'allowed',
        label: payload.sourceAlbumId === target.id ? 'Already here' : 'Drop',
      });
    },
    onDragOver: (event) => {
      accept(event);
    },
    onDragLeave: (event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      if (context.feedback?.albumId === target.id && (context.feedback.phase === 'allowed' || context.feedback.phase === 'no-op')) {
        context.setFeedback(null);
      }
    },
    onDrop: (event) => {
      const payload = accept(event);
      endPhotoDrag();
      if (payload === null) return;
      if (payload.sourceAlbumId === target.id) {
        context.showTemporary({ albumId: target.id, phase: 'no-op', label: 'Already here' });
        context.dispatch({
          type: 'toast/shown',
          toast: {
            title: `${formatCount(payload.photoIds.length)} ${noun(payload.photoIds.length)} already in ${target.name} · no changes`,
            tone: 'neutral',
          },
        });
        return;
      }
      const source = payload.sourceAlbumId === null ? undefined : context.albums.find((album) => album.id === payload.sourceAlbumId);
      if (source === undefined) addPhotos(payload, target, context);
      else {
        context.setFeedback(null);
        context.setChoice({ payload, source, target });
      }
    },
  };
}

export function useAlbumPhotoDrop(albums: readonly AlbumSummary[]): {
  readonly feedback: AlbumDropFeedback | null;
  readonly choice: AlbumDropChoice | null;
  readonly targetProps: (album: AlbumSummary) => AlbumDropTargetProps;
  readonly chooseAdd: () => void;
  readonly chooseMove: () => void;
  readonly closeChoice: () => void;
} {
  const { formatCount } = useFormats();
  const dispatch = useAppDispatch();
  const [feedback, setFeedback] = useState<AlbumDropFeedback | null>(null);
  const [choice, setChoice] = useState<AlbumDropChoice | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const showTemporary = (next: AlbumDropFeedback): void => {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    setFeedback(next);
    resetTimerRef.current = setTimeout(() => setFeedback(null), 1_200);
  };

  const effects = { dispatch, formatCount, setFeedback, showTemporary };

  return {
    feedback,
    choice,
    targetProps: (target) => targetPropsFor(target, { albums, feedback, setChoice, ...effects }),
    chooseAdd: () => {
      if (choice === null) return;
      const current = choice;
      setChoice(null);
      addPhotos(current.payload, current.target, effects);
    },
    chooseMove: () => {
      if (choice === null) return;
      const current = choice;
      setChoice(null);
      movePhotos(current, effects);
    },
    closeChoice: () => setChoice(null),
  };
}
