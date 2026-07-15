import { z } from 'zod';

export const restoreFailureSchema = z.enum([
  'auth',
  'offline',
  'disk-space',
  'corrupt',
  'wrong-key',
  'unsupported',
  'destructive-authorization',
  'cancelled',
  'io',
]);

export const restoreErrorSchema = z.object({
  reason: restoreFailureSchema,
  message: z.string().min(1),
});

export const restoreProgressSchema = z.object({
  stage: z.enum(['discovering', 'downloading', 'rebuilding', 'activating', 'complete']),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  photoId: z.string().nullable(),
});

export const restoreLibrarySummarySchema = z.object({
  libraryId: z.string().min(1),
  generation: z.number().int().positive().nullable(),
  generatedAt: z.string().datetime().nullable(),
  photos: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),
  albums: z.number().int().nonnegative().nullable(),
  compatibility: z.enum(['compatible', 'unsupported', 'unknown']),
  validation: z.enum(['valid', 'wrong-key', 'corrupt', 'unsupported']),
  fallbackGenerations: z.number().int().nonnegative(),
  resumable: z.boolean(),
});

export const restoreDiscoverResponseSchema = z.object({
  sessionId: z.string().min(1).nullable(),
  libraries: z.array(restoreLibrarySummarySchema).readonly(),
  error: restoreErrorSchema.nullable(),
});

export const restoreRunResponseSchema = z.object({
  result: z
    .object({
      libraryId: z.string().min(1),
      generation: z.number().int().positive(),
      photos: z.number().int().nonnegative(),
      resumed: z.boolean(),
      fallbackFromGeneration: z.number().int().positive().nullable(),
      relaunching: z.boolean(),
    })
    .nullable(),
  error: restoreErrorSchema.nullable(),
});

export type RestoreFailure = z.output<typeof restoreFailureSchema>;
export type RestoreProgressContract = z.output<typeof restoreProgressSchema>;
export type RestoreLibrarySummary = z.output<typeof restoreLibrarySummarySchema>;
export type RestoreDiscoverResponse = z.output<typeof restoreDiscoverResponseSchema>;
export type RestoreRunResponse = z.output<typeof restoreRunResponseSchema>;
