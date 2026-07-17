import { z } from 'zod';

export const diagnosticEventIdSchema = z.string().uuid();

export const diagnosticEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: diagnosticEventIdSchema,
    capturedAt: z.string().datetime({ offset: true }),
    appVersion: z.string().min(1).max(32),
    platform: z.enum(['darwin', 'win32', 'linux']),
    arch: z.enum(['arm64', 'x64']),
    kind: z.enum(['main-process-runtime-error', 'renderer-process-gone', 'child-process-gone', 'renderer-unresponsive']),
    reason: z.enum(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure']).optional(),
    exitCode: z.number().int().optional(),
  })
  .strict();

export type DiagnosticEvent = z.output<typeof diagnosticEventSchema>;

export function serializeDiagnosticEvent(input: unknown): string {
  return JSON.stringify(diagnosticEventSchema.parse(input));
}

export function deserializeDiagnosticEvent(serialized: string): DiagnosticEvent {
  return diagnosticEventSchema.parse(JSON.parse(serialized));
}
