import { defineConfig } from '@playwright/test';

// The M11 perf harness (#123): NOT part of the per-PR gates — run locally
// via `npm run test:perf` or the manual CI lane (perf.yml). One worker, one
// long test, real timings.
export default defineConfig({
  testDir: './tests/perf',
  globalSetup: './tests/perf/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
});
