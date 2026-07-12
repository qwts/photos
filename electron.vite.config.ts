import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

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
    plugins: [react()],
  },
});
