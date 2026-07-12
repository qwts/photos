// Test fixture (#86): a worker that accepts jobs and never answers —
// exercises close() with a saturated pool and a queued backlog.
import { parentPort } from 'node:worker_threads';

parentPort?.on('message', () => {
  // Never reply; the listener keeps the thread alive.
});
