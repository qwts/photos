import { z } from 'zod';

export type InteropJsonValue = null | boolean | number | string | InteropJsonValue[] | { [key: string]: InteropJsonValue };
export type InteropJsonObject = { [key: string]: InteropJsonValue };

export const interopJsonValueSchema: z.ZodType<InteropJsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(interopJsonValueSchema), interopJsonObjectSchema]),
);

export const interopJsonObjectSchema: z.ZodType<InteropJsonObject> = z.record(z.string(), interopJsonValueSchema);
