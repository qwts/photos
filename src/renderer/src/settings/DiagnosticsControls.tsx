import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useIntl } from 'react-intl';

import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { destructiveActions } from '../../../shared/destructive-actions.js';

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
  const intl = useIntl();
  const [confirming, setConfirming] = useState<DiagnosticReport | 'all' | null>(null);
  const remove = async (eventId: string): Promise<void> => {
    try {
      const { deleted } = await window.overlook.diagnostics.delete({ eventId });
      if (deleted) onReports(reports.filter((report) => report.eventId !== eventId));
      onNotice(deleted ? 'Diagnostic report cleared.' : 'That report was already gone.');
    } catch {
      onNotice('The diagnostic report could not be cleared.');
    }
  };
  const purge = async (): Promise<void> => {
    try {
      const { deleted } = await window.overlook.diagnostics.purge();
      onReports([]);
      onNotice(`${deleted} diagnostic ${deleted === 1 ? 'report' : 'reports'} cleared.`);
    } catch {
      onNotice('Local reports could not be cleared.');
    }
  };
  const exportReports = async (): Promise<void> => {
    try {
      const result = await window.overlook.diagnostics.export({ eventIds: reports.map((report) => report.eventId) });
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
          <Button variant="danger" icon="trash-2" disabled={reports.length === 0} onClick={() => setConfirming('all')}>
            {destructiveActions.clearDiagnostics.label}…
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
                  <span>{intl.formatDate(report.capturedAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(report)}>
                  Clear report…
                </Button>
              </header>
              <pre>{report.payload}</pre>
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={confirming !== null}
        title={
          confirming === 'all'
            ? `Clear ${reports.length} diagnostic ${reports.length === 1 ? 'report' : 'reports'}?`
            : 'Clear diagnostic report?'
        }
        icon="trash-2"
        width={440}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (target === 'all') void purge();
                else if (target !== null) void remove(target.eventId);
              }}
            >
              {confirming === 'all' ? destructiveActions.clearDiagnostics.label : 'Clear report'}
            </Button>
          </>
        }
      >
        <p>
          {confirming === 'all'
            ? `This removes all ${reports.length} encrypted diagnostic reports stored on this device.`
            : 'This removes this encrypted diagnostic report from this device.'}{' '}
          This cannot be undone.
        </p>
        <p>{destructiveActions.clearDiagnostics.survival} Nothing was sent.</p>
      </Dialog>
    </Dialog>
  );
}
