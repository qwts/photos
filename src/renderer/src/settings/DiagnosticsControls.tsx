import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';

type DiagnosticReport = Awaited<ReturnType<typeof window.overlook.diagnostics.list>>['reports'][number];

export function DiagnosticsControls({ enabled }: { readonly enabled: boolean }): ReactElement {
  if (!enabled) {
    return (
      <div className="ovl-settings__diagnostics">
        <span className="ovl-diagnostics__status">Diagnostics are off</span>
        <Button size="sm" variant="ghost" disabled>
          Review reports…
        </Button>
      </div>
    );
  }
  return <EnabledDiagnosticsControls />;
}

function EnabledDiagnosticsControls(): ReactElement {
  const [reports, setReports] = useState<DiagnosticReport[] | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await window.overlook.diagnostics.list();
      setReports(result.reports);
      setNotice(null);
    } catch {
      setNotice('Local reports could not be read.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void window.overlook.diagnostics
      .list()
      .then((result) => {
        if (active) setReports(result.reports);
      })
      .catch(() => {
        if (active) setNotice('Local reports could not be read.');
      });
    return () => {
      active = false;
    };
  }, []);

  const pending = reports?.length ?? 0;
  return (
    <div className="ovl-settings__diagnostics">
      <span className="ovl-diagnostics__status" aria-live="polite">
        {`${pending} pending local ${pending === 1 ? 'report' : 'reports'}`}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        Review reports…
      </Button>
      <DiagnosticsReviewDialog
        open={open}
        reports={reports ?? []}
        notice={notice}
        onReports={setReports}
        onNotice={setNotice}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

interface ReviewProps {
  readonly open: boolean;
  readonly reports: readonly DiagnosticReport[];
  readonly notice: string | null;
  readonly onReports: (reports: DiagnosticReport[]) => void;
  readonly onNotice: (notice: string | null) => void;
  readonly onClose: () => void;
}

function DiagnosticsReviewDialog({ open, reports, notice, onReports, onNotice, onClose }: ReviewProps): ReactElement | null {
  const remove = async (eventId: string): Promise<void> => {
    try {
      const { deleted } = await window.overlook.diagnostics.delete({ eventId });
      if (deleted) onReports(reports.filter((report) => report.eventId !== eventId));
      onNotice(deleted ? 'Report deleted.' : 'That report was already gone.');
    } catch {
      onNotice('The report could not be deleted.');
    }
  };
  const purge = async (): Promise<void> => {
    try {
      const { deleted } = await window.overlook.diagnostics.purge();
      onReports([]);
      onNotice(`${deleted} ${deleted === 1 ? 'report' : 'reports'} deleted.`);
    } catch {
      onNotice('Local reports could not be deleted.');
    }
  };
  const exportReports = async (): Promise<void> => {
    try {
      const result = await window.overlook.diagnostics.export();
      onNotice(result.exported ? `${result.count} ${result.count === 1 ? 'report' : 'reports'} exported.` : 'Export canceled.');
    } catch {
      onNotice('Local reports could not be exported.');
    }
  };

  return (
    <Dialog
      open={open}
      title="Review diagnostics"
      icon="shield-check"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon="download" onClick={() => void exportReports()}>
            Export JSONL…
          </Button>
          <Button variant="danger" icon="trash-2" disabled={reports.length === 0} onClick={() => void purge()}>
            Delete all
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p>These exact allowlisted payloads remain encrypted on this device. Nothing is sent.</p>
      {notice === null ? null : (
        <p className="ovl-diagnostics__notice" role="status">
          {notice}
        </p>
      )}
      {reports.length === 0 ? (
        <p>No reports are waiting locally.</p>
      ) : (
        <div className="ovl-diagnostics__list">
          {reports.map((report) => (
            <article className="ovl-diagnostics__report" key={report.eventId}>
              <header>
                <div>
                  <strong>{report.kind}</strong>
                  <span>{new Date(report.capturedAt).toLocaleString()}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void remove(report.eventId)}>
                  Delete
                </Button>
              </header>
              <pre>{report.payload}</pre>
            </article>
          ))}
        </div>
      )}
    </Dialog>
  );
}
