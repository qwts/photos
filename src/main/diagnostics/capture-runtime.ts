import type { DiagnosticOccurrence } from './diagnostics-service.js';

export interface DiagnosticsRecorder {
  readonly record: (occurrence: DiagnosticOccurrence) => boolean;
}

export interface DiagnosticsCaptureSource {
  readonly onMainRuntimeError: (listener: () => void) => () => void;
  readonly onRendererProcessGone: (listener: (details: { readonly reason: string; readonly exitCode: number }) => void) => () => void;
  readonly onChildProcessGone: (listener: (details: { readonly reason: string; readonly exitCode: number }) => void) => () => void;
  readonly onRendererUnresponsive: (listener: () => void) => () => void;
}

export function attachDiagnosticsCapture(_source: DiagnosticsCaptureSource, _recorder: DiagnosticsRecorder): () => void {
  return () => undefined;
}
