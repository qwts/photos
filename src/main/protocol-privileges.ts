import { protocol } from 'electron';

import { schemePrivilegeContract } from './protocol-privilege-contract.js';

// Electron allows exactly one registerSchemesAsPrivileged call (it replaces
// the whole list), and it MUST run before app ready — so every Overlook
// scheme registers here, together.
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([...schemePrivilegeContract]);
}
