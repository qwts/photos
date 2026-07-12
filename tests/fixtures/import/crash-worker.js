// Test fixture (#86): a "thumbnail worker" that dies immediately — exercises
// the pool's crashed-worker path (reject own job, correct the books, never
// hang the queue). Plain JS on purpose: worker_threads loads it directly.
process.exit(1);
