import e2eGlobalSetup from '../e2e/global-setup.js';

/** Performance budgets measure a visible native window, including frame delivery. */
export function configurePerfEnvironment(): void {
  process.env['OVERLOOK_E2E_VISIBLE'] = '1';
}

export default function perfGlobalSetup(): void {
  configurePerfEnvironment();
  e2eGlobalSetup();
}
