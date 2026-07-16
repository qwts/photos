export async function drainBeforeDeadline(tasks: readonly Promise<unknown>[], timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('library work did not drain before the lock deadline')), timeoutMs);
  });
  try {
    await Promise.race([Promise.all(tasks), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
