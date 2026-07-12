import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// Vite's dev tooling needs CSP allowances production must never ship: the
// React Fast Refresh preamble is an inline script, @vite/client spawns a
// blob: worker, and HMR runs over a websocket. While serving, swap the strict
// production policy in index.html (kept there as the source of truth) for
// this dev policy.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: overlook-full:",
  "worker-src 'self' blob:",
  // Mirror production's protocol allowances (#75 thumbs, #91 full-res).
  "img-src 'self' overlook-thumb: overlook-full:",
].join('; ');

function relaxCspForDev(): Plugin {
  return {
    name: 'overlook:relax-csp-for-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      const swapped = html.replace(/content="default-src [^"]*"/, `content="${DEV_CSP}"`);
      if (swapped === html) {
        throw new Error('relax-csp-for-dev: CSP meta tag not found in index.html');
      }
      return swapped;
    },
  };
}

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: {
          // Sandboxed renderers can only load CJS preloads; the package is ESM
          // ("type": "module"), so the preload bundle must opt out explicitly.
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [react(), relaxCspForDev()],
  },
});
