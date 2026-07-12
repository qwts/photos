import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { Dispatch, ReactElement, ReactNode } from 'react';

import { appReducer, initialAppState, type AppAction, type AppState } from '../../../shared/library/app-state.js';

// Context + pure reducer (#73 decision note): the reducer lives in
// src/shared under the coverage floor; this file only wires React and the
// IPC push events.

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppStateProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  useEffect(() => {
    const unsubscribePending = window.overlook.library.onPendingCountChanged(({ count }) => {
      dispatch({ type: 'pendingCount/set', count });
    });
    return unsubscribePending;
  }, []);

  const stateValue = useMemo(() => state, [state]);
  return (
    <StateContext.Provider value={stateValue}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  const state = useContext(StateContext);
  if (state === null) {
    throw new Error('useAppState requires AppStateProvider');
  }
  return state;
}

export function useAppDispatch(): Dispatch<AppAction> {
  const dispatch = useContext(DispatchContext);
  if (dispatch === null) {
    throw new Error('useAppDispatch requires AppStateProvider');
  }
  return dispatch;
}
