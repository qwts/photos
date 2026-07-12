// Test fixture (#86): a worker that throws during module initialization —
// exercises the pool's 'error' event path (consumed, surfaced as the job's
// rejection cause, never rethrown on the main process).
throw new Error('boom at module init');
