import { registerDiagnosticsLifecycle } from './diagnostics/diagnostics-runtime.js';
import { registerSchemePrivileges } from './protocol-privileges.js';

/** Pre-window process wiring that must be installed before app readiness. */
export function registerEarlyRuntime(): void {
  registerSchemePrivileges();
  registerDiagnosticsLifecycle();
}
