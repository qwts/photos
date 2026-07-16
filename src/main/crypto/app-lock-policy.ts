import type { AppSettings } from '../../shared/settings/settings.js';

export function idleLimitSeconds(setting: AppSettings['appLockIdle']): number | null {
  return setting === 'never' ? null : Number(setting) * 60;
}
