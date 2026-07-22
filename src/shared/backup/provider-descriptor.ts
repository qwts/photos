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

// Provider storage status (#684): two independent, differently-sourced figures
// that never blend. `usedByOverlook` is what Overlook measures itself — the
// exact sum of its own remote objects — while `capacity` is the account-wide
// total/free and appears ONLY when a verified account-quota API supplies it
// (Google Drive `about.storageQuota`, pCloud `userinfo`). iCloud has no
// trustworthy account-quota API, so it reports the used figure plus a
// System Settings route (`capacityRoute`) and never a fabricated total — and
// local disk capacity is never passed off as account free space.

/** Account-wide capacity from a verified provider quota API (never local disk). */
export const providerCapacitySchema = z.object({
  usedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
});

/** Prompt connection authority. Remote inventory and quota are deliberately
 * excluded so OAuth completion can render before storage metrics finish. */
export const providerConnectionStatusSchema = z.object({
  provider: providerDescriptorSchema,
  connected: z.boolean(),
  /** Account label when the provider exposes one; otherwise null. */
  account: z.string().nullable(),
});

/** Slow, informational storage metrics. Failures here never change provider
 * authority and are fetched independently from providerConnectionStatus. */
export const providerStorageMetricsSchema = z.object({
  /** "Used by Overlook": exact bytes summed from Overlook's own remote objects.
   * Null when not connected or the current measurement produced no figure. */
  usedByOverlookBytes: z.number().nonnegative().nullable(),
  /** ISO timestamp of the last successful measurement; drives the stale marker. */
  measuredAt: z.string().nullable(),
  /** The last measurement attempt failed (calculation-failure). Any retained
   * figure the renderer still shows is stale, never promoted to current. */
  measurementFailed: z.boolean(),
  /** Verified account-wide capacity, or null when no trustworthy source exists. */
  capacity: providerCapacitySchema.nullable(),
  /** Where to route the user for capacity when `capacity` is null. `system-settings`
   * is iCloud's honest fallback (opens macOS System Settings); `none` shows a plain
   * "capacity unavailable" for a provider whose quota call genuinely failed. */
  capacityRoute: z.enum(['system-settings', 'none']),
});

export type ProviderConnectionStatus = z.output<typeof providerConnectionStatusSchema>;
export type ProviderStorageMetrics = z.output<typeof providerStorageMetricsSchema>;
