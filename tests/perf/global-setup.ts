import e2eGlobalSetup from '../e2e/global-setup.js';

/** Performance budgets measure a visible native window, including frame delivery.
 * The window opens inactive (showInactive) so a minutes-long perf run never steals
 * the user's desktop focus; rendering and frame delivery are unaffected. Force a
 * focused window with OVERLOOK_NO_FOCUS=0. */
export function configurePerfEnvironment(): void {
  process.env['OVERLOOK_E2E_VISIBLE'] = '1';
  process.env['OVERLOOK_NO_FOCUS'] ??= '1';
}

export default function perfGlobalSetup(): void {
  configurePerfEnvironment();
  e2eGlobalSetup();
}
