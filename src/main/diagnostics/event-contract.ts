import { z } from 'zod';

const diagnosticEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    capturedAt: z.string().datetime({ offset: true }),
    appVersion: z.string().min(1).max(32),
    platform: z.enum(['darwin', 'win32', 'linux']),
    arch: z.enum(['arm64', 'x64']),
    kind: z.enum(['renderer-process-gone', 'child-process-gone', 'renderer-unresponsive']),
    reason: z.enum(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure']).optional(),
    exitCode: z.number().int().optional(),
  })
  .passthrough();

export function serializeDiagnosticEvent(input: unknown): string {
  return JSON.stringify(diagnosticEventSchema.parse(input));
}
