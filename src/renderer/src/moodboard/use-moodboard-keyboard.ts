import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// Keyboard map for the Moodboard canvas (#693, invariant I5). Every pointer
// gesture has an equivalent here: arrows move (Shift = 10px), ⌥arrows resize
// (⌥⇧ keeps aspect), [ ] rotate (Shift snaps 15°), ⌘[ ⌘] layer, ⌘G/⌘⇧G
// group/ungroup, C crop (Enter commit / Esc cancel), + - 0 zoom, Space+arrows
// (or arrows with no selection) pan, Delete removes.

export interface MoodboardKeyActions {
  readonly nudge: (dx: number, dy: number) => void;
  readonly resize: (dw: number, dh: number, keepAspect: boolean) => void;
  readonly rotate: (delta: number, snap: boolean) => void;
  readonly layer: (direction: 1 | -1) => void;
  readonly group: () => void;
  readonly ungroup: () => void;
  readonly remove: () => void;
  readonly zoom: (direction: 1 | -1 | 0) => void;
  readonly pan: (dx: number, dy: number) => void;
  readonly toggleCrop: () => void;
  readonly commitCrop: () => void;
  readonly cancelCrop: () => void;
  readonly adjustCrop: (dx: number, dy: number) => void;
}

export interface MoodboardKeyState {
  readonly hasSelection: boolean;
  readonly cropMode: boolean;
  readonly spaceHeld: boolean;
}

const ARROW_UNITS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const PAN_STEP = 48;

function arrowUnit(key: string): readonly [number, number] | null {
  return ARROW_UNITS[key] ?? null;
}

/** The canvas keydown handler: a pure mapping of key → action. The component
 * owns the actual state mutations and live-region announcements. */
export function handleMoodboardKey(event: ReactKeyboardEvent, state: MoodboardKeyState, actions: MoodboardKeyActions): void {
  const primary = event.metaKey || event.ctrlKey;
  const arrow = arrowUnit(event.key);

  if (state.cropMode) {
    if (event.key === 'Enter') {
      event.preventDefault();
      actions.commitCrop();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      actions.cancelCrop();
    } else if (arrow !== null) {
      event.preventDefault();
      actions.adjustCrop(arrow[0], arrow[1]);
    }
    return;
  }

  if (arrow !== null) {
    event.preventDefault();
    const [ux, uy] = arrow;
    if (state.spaceHeld || !state.hasSelection) {
      actions.pan(-ux * PAN_STEP, -uy * PAN_STEP);
      return;
    }
    if (event.altKey) {
      actions.resize(ux, uy, event.shiftKey);
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    actions.nudge(ux * step, uy * step);
    return;
  }

  switch (event.key) {
    case ' ':
      event.preventDefault();
      return;
    case ']':
      event.preventDefault();
      if (primary) actions.layer(1);
      else actions.rotate(event.shiftKey ? 15 : 1, event.shiftKey);
      return;
    case '[':
      event.preventDefault();
      if (primary) actions.layer(-1);
      else actions.rotate(event.shiftKey ? -15 : -1, event.shiftKey);
      return;
    case 'g':
    case 'G':
      if (primary) {
        event.preventDefault();
        if (event.shiftKey) actions.ungroup();
        else actions.group();
      }
      return;
    case 'c':
    case 'C':
      event.preventDefault();
      actions.toggleCrop();
      return;
    case '+':
    case '=':
      event.preventDefault();
      actions.zoom(1);
      return;
    case '-':
    case '_':
      event.preventDefault();
      actions.zoom(-1);
      return;
    case '0':
      event.preventDefault();
      actions.zoom(0);
      return;
    case 'Delete':
    case 'Backspace':
      if (state.hasSelection) {
        event.preventDefault();
        actions.remove();
      }
      return;
    default:
      return;
  }
}
