import { defineConfig } from '@playwright/test';

const isCi = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // Files are the unit of parallelism: fullyParallel stays false so tests within a
  // spec run serially, but distinct spec files run concurrently across workers.
  // The app is built once in global-setup.
  fullyParallel: false,
  // exactOptionalPropertyTypes forbids an explicit `workers: undefined`, so spread
  // the CI-only override instead of image-trail's ternary.
  ...(isCi ? { workers: 3 } : {}),
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  // 'github' turns failures into file/line-anchored annotations in the run summary UI; without it
  // a red E2E step shows only a blank "Error:". 'list' keeps the readable log, 'html' the artifact.
  reporter: isCi ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  // Serves the static E2E fixture pages; when the app grows a real UI surface this
  // becomes the command that serves the built app instead.
  webServer: {
    command: 'node node_modules/http-server/bin/http-server tests/e2e/pages --host 127.0.0.1 --port 4173 --silent',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !isCi,
    timeout: 30_000,
  },
});
