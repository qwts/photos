import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  attachDiagnosticsCapture,
  type DiagnosticsCaptureSource,
  type DiagnosticsRecorder,
} from '../../src/main/diagnostics/capture-runtime.js';
import type { DiagnosticOccurrence } from '../../src/main/diagnostics/diagnostics-service.js';

describe('diagnostics capture adapter (#286)', () => {
  test('forwards only the closed process-health vocabulary and detaches every listener', () => {
    let main: (() => void) | undefined;
    let rendererGone: ((details: { reason: string; exitCode: number }) => void) | undefined;
    let childGone: ((details: { reason: string; exitCode: number }) => void) | undefined;
    let unresponsive: (() => void) | undefined;
    let detached = 0;
    const detach = (): void => {
      detached += 1;
    };
    const source: DiagnosticsCaptureSource = {
      onMainRuntimeError: (listener) => {
        main = listener;
        return detach;
      },
      onRendererProcessGone: (listener) => {
        rendererGone = listener;
        return detach;
      },
      onChildProcessGone: (listener) => {
        childGone = listener;
        return detach;
      },
      onRendererUnresponsive: (listener) => {
        unresponsive = listener;
        return detach;
      },
    };
    const seen: DiagnosticOccurrence[] = [];
    const recorder: DiagnosticsRecorder = {
      record: (occurrence) => {
        seen.push(occurrence);
        return true;
      },
    };

    const close = attachDiagnosticsCapture(source, recorder);
    main?.();
    rendererGone?.({ reason: 'crashed', exitCode: 5, path: '/Users/private/Pictures' } as never);
    childGone?.({ reason: 'oom', exitCode: 9, serviceName: 'private-family-photo.jpg' } as never);
    unresponsive?.();

    assert.deepEqual(seen, [
      { kind: 'main-process-runtime-error' },
      { kind: 'renderer-process-gone', reason: 'crashed', exitCode: 5 },
      { kind: 'child-process-gone', reason: 'oom', exitCode: 9 },
      { kind: 'renderer-unresponsive' },
    ]);
    close();
    assert.equal(detached, 4);
  });
});
