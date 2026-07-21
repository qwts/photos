export class WorkTracker {
  #count = 0;
  readonly #waiters = new Set<() => void>();

  constructor(private readonly onChange: () => void = () => undefined) {}

  change(delta: 1 | -1): void {
    const next = this.#count + delta;
    if (next < 0) throw new Error('Work tracker underflow.');
    this.#count = next;
    this.onChange();
    if (next !== 0) return;
    for (const resolve of this.#waiters) resolve();
    this.#waiters.clear();
  }

  busy(): boolean {
    return this.#count > 0;
  }

  idle(): Promise<void> {
    return this.busy() ? new Promise((resolve) => this.#waiters.add(resolve)) : Promise.resolve();
  }
}
