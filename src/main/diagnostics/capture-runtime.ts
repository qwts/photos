import type { DiagnosticOccurrence } from './diagnostics-service.js';
import type { DiagnosticEvent } from './event-contract.js';

type DiagnosticReason = NonNullable<DiagnosticEvent['reason']>;

export interface DiagnosticsRecorder {
  readonly record: (occurrence: DiagnosticOccurrence) => boolean;
}

export interface DiagnosticsCaptureSource {
  readonly onMainRuntimeError: (listener: () => void) => () => void;
  readonly onRendererProcessGone: (
    listener: (details: { readonly reason: DiagnosticReason; readonly exitCode: number }) => void,
  ) => () => void;
  readonly onChildProcessGone: (
    listener: (details: { readonly reason: DiagnosticReason; readonly exitCode: number }) => void,
  ) => () => void;
  readonly onRendererUnresponsive: (listener: () => void) => () => void;
}

export function attachDiagnosticsCapture(source: DiagnosticsCaptureSource, recorder: DiagnosticsRecorder): () => void {
  const detach = [
    source.onMainRuntimeError(() => recorder.record({ kind: 'main-process-runtime-error' })),
    source.onRendererProcessGone(({ reason, exitCode }) => recorder.record({ kind: 'renderer-process-gone', reason, exitCode })),
    source.onChildProcessGone(({ reason, exitCode }) => recorder.record({ kind: 'child-process-gone', reason, exitCode })),
    source.onRendererUnresponsive(() => recorder.record({ kind: 'renderer-unresponsive' })),
  ];
  return () => {
    for (const unsubscribe of detach) unsubscribe();
  };
}
