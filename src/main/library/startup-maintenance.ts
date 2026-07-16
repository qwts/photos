import { CustodyWorkTracker } from '../crypto/library-shutdown.js';

export interface StartupRepairSummary {
  readonly orphanOriginals: readonly unknown[];
  readonly orphanThumbs: readonly unknown[];
  readonly stagedLeftovers: readonly unknown[];
  readonly lyingRows: readonly unknown[];
}

export interface StartupMaintenanceOptions {
  readonly purge: () => Promise<unknown>;
  readonly repair: () => Promise<StartupRepairSummary> | undefined;
}

export class StartupMaintenance {
  private readonly work = new CustodyWorkTracker();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: StartupMaintenanceOptions) {}

  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => this.start(), 0);
  }

  cancel(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  drain(): Promise<void> {
    return this.work.drain();
  }

  private start(): void {
    this.timer = undefined;
    void this.work.track(
      this.options.purge().catch((error: unknown) => {
        console.error('[overlook] retention purge failed', error);
      }),
    );

    const repair = this.options.repair();
    if (repair === undefined) return;
    void this.work.track(
      repair
        .then((summary) => {
          const issues =
            summary.orphanOriginals.length + summary.orphanThumbs.length + summary.stagedLeftovers.length + summary.lyingRows.length;
          if (issues > 0) console.warn('[overlook] consistency repair:', JSON.stringify(summary));
        })
        .catch((error: unknown) => {
          console.error('[overlook] consistency check failed', error);
        }),
    );
  }
}
