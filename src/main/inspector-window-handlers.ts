import { channels, events } from '../shared/ipc/channels.js';
import { wrapHandler } from '../shared/ipc/registry.js';
import type { InspectorWindowState } from '../shared/inspector-window-contract.js';

export interface InspectorWindowHandlerDependencies {
  readonly admitContent: () => void;
  readonly handle: (name: string, handler: (request: unknown) => unknown) => void;
  readonly open: (state: InspectorWindowState) => void;
  readonly update: (state: InspectorWindowState) => void;
  readonly close: () => void;
  readonly snapshot: () => InspectorWindowState;
  readonly sendStep: (name: string, payload: { delta: -1 | 1 }) => void;
}

export function registerInspectorWindowHandlerContract(dependencies: InspectorWindowHandlerDependencies): void {
  const validated: typeof wrapHandler = (channel, handler) =>
    wrapHandler(channel, (request) => {
      dependencies.admitContent();
      return handler(request);
    });
  dependencies.handle(channels.inspectorWindowOpen.name, (request) =>
    validated(channels.inspectorWindowOpen, (state) => (dependencies.open(state), {}))(request),
  );
  dependencies.handle(channels.inspectorWindowUpdate.name, (request) =>
    validated(channels.inspectorWindowUpdate, (state) => (dependencies.update(state), {}))(request),
  );
  dependencies.handle(channels.inspectorWindowClose.name, (request) =>
    validated(channels.inspectorWindowClose, () => (dependencies.close(), {}))(request),
  );
  dependencies.handle(channels.inspectorWindowStep.name, (request) =>
    validated(
      channels.inspectorWindowStep,
      ({ delta }) => (dependencies.sendStep(events.inspectorWindowStepRequested.name, { delta }), {}),
    )(request),
  );
  dependencies.handle(channels.inspectorWindowSnapshot.name, (request) =>
    validated(channels.inspectorWindowSnapshot, () => dependencies.snapshot())(request),
  );
}
