import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import type { PhotoRecord } from '../../../shared/library/types.js';
import { Inspector } from './Inspector';

import './detached-inspector-window.css';

type InspectorWindowState = Awaited<ReturnType<typeof window.overlook.inspectorWindow.snapshot>>;

const messages = defineMessages({
  windowLabel: { id: 'inspector.window.label', defaultMessage: 'Inspector window' },
});

export function DetachedInspectorWindow(): ReactElement {
  const intl = useIntl();
  const [state, setState] = useState<InspectorWindowState>({ photoId: null, providerLabel: 'Cloud', selectionPosition: null });
  const [photo, setPhoto] = useState<PhotoRecord | null>(null);

  useEffect(() => {
    void window.overlook.inspectorWindow.snapshot().then(setState);
    return window.overlook.inspectorWindow.onChanged(setState);
  }, []);

  useEffect(() => {
    let current = true;
    if (state.photoId === null) {
      return () => {
        current = false;
      };
    }
    void window.overlook.library.get({ id: state.photoId }).then(({ photo: next }) => {
      if (current) setPhoto(next);
    });
    return () => {
      current = false;
    };
  }, [state]);

  const step = useCallback((delta: 1 | -1) => {
    void window.overlook.inspectorWindow.step(delta);
  }, []);

  return (
    <main className="ovl-detachedInspector" aria-label={intl.formatMessage(messages.windowLabel)}>
      <Inspector
        photo={photo?.id === state.photoId ? photo : null}
        providerLabel={state.providerLabel}
        selectionPosition={state.selectionPosition ?? undefined}
        onPrevious={() => step(-1)}
        onNext={() => step(1)}
      />
    </main>
  );
}
