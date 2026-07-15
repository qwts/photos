import { z } from 'zod';

export const providerIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/u);

export const providerCapabilitiesSchema = z.object({
  quota: z.enum(['known', 'unknown']),
  verification: z.enum(['server-checksum', 'download-hash']),
  resumableUpload: z.boolean(),
  platforms: z
    .array(z.enum(['darwin', 'win32', 'linux']))
    .min(1)
    .readonly(),
  interactiveAuth: z.boolean(),
  reconnectRequired: z.boolean(),
});

export const providerDescriptorSchema = z.object({
  id: providerIdSchema,
  label: z.string().min(1),
  capabilities: providerCapabilitiesSchema,
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});

export type ProviderId = z.output<typeof providerIdSchema>;
export type ProviderCapabilities = z.output<typeof providerCapabilitiesSchema>;
export type ProviderDescriptor = z.output<typeof providerDescriptorSchema>;
