import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import type { ProviderDescriptor } from '../../../shared/backup/provider-descriptor.js';
import type { RestoreLibrarySummary, RestoreProgressContract } from '../../../shared/backup/restore-contract.js';
import { formatBytes, formatCount } from '../../../shared/library/format.js';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';

import './restore.css';

export interface RestoreWorkflowProps {
  readonly context: 'onboarding' | 'settings';
  readonly onStartNew?: (() => void) | undefined;
}

type Step = 'setup' | 'choose' | 'confirm' | 'running' | 'complete';

const ERROR_HELP: Record<string, string> = {
  auth: 'Reconnect the provider, then try discovery again.',
  offline: 'Check your connection. The staged restore can resume when the provider is reachable.',
  'disk-space': 'Free local disk space, then resume. No active-library data was changed.',
  corrupt: 'The cloud copy failed validation. A retained generation may still be available.',
  'wrong-key': 'Use the recovery key and password exported for this library.',
  unsupported: 'Update Overlook before restoring this newer backup.',
  'destructive-authorization': 'Confirm replacement before restoring over this library.',
  cancelled: 'Restore paused. Verified staged work remains available to resume.',
  io: 'The restore could not continue. Your active library remains unchanged.',
};

const messages = defineMessages({
  openExisting: { id: 'restore.local.openExisting', defaultMessage: 'Open existing library…' },
  openingExisting: { id: 'restore.local.openingExisting', defaultMessage: 'Opening local library…' },
  notLibrary: { id: 'restore.local.error.notLibrary', defaultMessage: "That folder isn't an Overlook library." },
  notLibraryHelp: {
    id: 'restore.local.error.notLibraryHelp',
    defaultMessage: 'Choose the Overlook library folder that contains library.db.',
  },
  alreadyRegistered: { id: 'restore.local.error.alreadyRegistered', defaultMessage: 'That library is already registered.' },
  alreadyRegisteredHelp: {
    id: 'restore.local.error.alreadyRegisteredHelp',
    defaultMessage: 'Choose the registered library from the library switcher.',
  },
  openFailed: { id: 'restore.local.error.openFailed', defaultMessage: 'The existing local library could not be opened.' },
  openFailedHelp: {
    id: 'restore.local.error.openFailedHelp',
    defaultMessage: 'The local library was not changed. Choose its folder and try again.',
  },
});

function fileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function stageLabel(stage: RestoreProgressContract['stage']): string {
  switch (stage) {
    case 'discovering':
      return 'Validating cloud backup';
    case 'downloading':
      return 'Downloading and verifying originals';
    case 'rebuilding':
      return 'Rebuilding thumbnails and catalog';
    case 'activating':
      return 'Activating restored library';
    case 'complete':
      return 'Restore complete';
  }
}

function LibraryCard({
  library,
  selected,
  onSelect,
}: {
  readonly library: RestoreLibrarySummary;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  const valid = library.validation === 'valid';
  return (
    <button
      type="button"
      className={`ovl-restore__library${selected ? ' ovl-restore__library--selected' : ''}`}
      disabled={!valid}
      aria-pressed={selected}
      onClick={onSelect}
      data-testid="restore-library-card"
    >
      <div className="ovl-restore__libraryHead">
        <span className="ovl-restore__libraryId mono-data">{library.libraryId}</span>
        <Badge tone={valid ? 'green' : library.validation === 'unsupported' ? 'amber' : 'red'}>
          {valid ? 'Validated' : library.validation.replace('-', ' ')}
        </Badge>
      </div>
      {valid ? (
        <div className="ovl-restore__meta mono-data">
          GEN {String(library.generation)} · {formatCount(library.photos ?? 0)} PHOTOS ·{' '}
          {formatBytes(library.totalBytes ?? 0).toUpperCase()} · {formatCount(library.albums ?? 0)} ALBUMS
        </div>
      ) : (
        <div className="ovl-restore__meta">Metadata is unavailable until this backup validates.</div>
      )}
      {library.generatedAt === null ? null : (
        <div className="ovl-restore__date">Backed up {new Date(library.generatedAt).toLocaleString()}</div>
      )}
      {library.fallbackGenerations > 0 ? (
        <div className="ovl-restore__notice">{formatCount(library.fallbackGenerations)} retained fallback generation available</div>
      ) : null}
      {library.resumable ? <div className="ovl-restore__notice">Verified staged work is ready to resume</div> : null}
    </button>
  );
}

export function RestoreWorkflow({ context, onStartNew }: RestoreWorkflowProps): ReactElement {
  const intl = useIntl();
  const [providers, setProviders] = useState<readonly ProviderDescriptor[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [openingLocal, setOpeningLocal] = useState(false);
  const [keyPath, setKeyPath] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('setup');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [libraries, setLibraries] = useState<readonly RestoreLibrarySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(context === 'onboarding');
  const [progress, setProgress] = useState<RestoreProgressContract | null>(null);
  const [error, setError] = useState<{ reason: string; message: string } | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  const descriptor = providers.find((provider) => provider.id === providerId) ?? null;
  const selected = useMemo(() => libraries.find((library) => library.libraryId === selectedId) ?? null, [libraries, selectedId]);

  useEffect(() => {
    void Promise.all([window.overlook.backup.providers(), window.overlook.settings.get()]).then(([catalog, settings]) => {
      setProviders(catalog.providers);
      const selectedProvider = catalog.providers.some((provider) => provider.id === settings.settings.providerId)
        ? settings.settings.providerId
        : catalog.defaultProviderId;
      setProviderId(selectedProvider);
    });
  }, []);

  useEffect(() => {
    if (providerId === null) return;
    void window.overlook.backup.providerStatus({ providerId }).then((status) => {
      setConnected(status.connected);
    });
  }, [providerId]);

  useEffect(() => window.overlook.restore.onProgress(setProgress), []);

  const discover = (): void => {
    if (providerId === null || keyPath === null || password === '') return;
    setError(null);
    setStep('choose');
    void window.overlook.restore.discover({ providerId, keyPath, password }).then((response) => {
      if (response.error !== null) {
        setError(response.error);
        setStep('setup');
        return;
      }
      setSessionId(response.sessionId);
      setLibraries(response.libraries);
      const firstValid = response.libraries.find((library) => library.validation === 'valid');
      setSelectedId(firstValid?.libraryId ?? null);
      if (firstValid === undefined) setError({ reason: 'wrong-key', message: 'No cloud library matches this recovery key.' });
    });
  };

  const run = (): void => {
    if (sessionId === null || selectedId === null || !authorized) return;
    setError(null);
    setStep('running');
    void window.overlook.restore.run({ sessionId, libraryId: selectedId, allowReplace: context === 'settings' }).then((response) => {
      if (response.error !== null) {
        setError(response.error);
        setStep('confirm');
        return;
      }
      if (response.result?.fallbackFromGeneration !== null && response.result?.fallbackFromGeneration !== undefined) {
        setFallbackNotice(
          `Generation ${String(response.result.fallbackFromGeneration)} failed validation; restored generation ${String(response.result.generation)}.`,
        );
      }
      setStep('complete');
    });
  };

  const openExisting = (): void => {
    if (openingLocal) return;
    setOpeningLocal(true);
    setError(null);
    void window.overlook.libraries
      .add({ path: null })
      .then((outcome) => {
        if (!outcome.ok) {
          setOpeningLocal(false);
          if (outcome.reason !== 'cancelled') {
            setError({
              reason: outcome.reason,
              message:
                outcome.reason === 'not-a-library'
                  ? intl.formatMessage(messages.notLibrary)
                  : intl.formatMessage(messages.alreadyRegistered),
            });
          }
          return;
        }
        // A fresh profile has no open library. With the retained directory
        // now its only registry entry, leaving onboarding lets the ordinary
        // lazy bootstrap open that entry without a destructive restore or a
        // live-switch teardown (#479).
        setOpeningLocal(false);
        onStartNew?.();
      })
      .catch(() => {
        setOpeningLocal(false);
        setError({ reason: 'local-open', message: intl.formatMessage(messages.openFailed) });
      });
  };

  return (
    <div className="ovl-restore" data-testid="restore-workflow">
      <div className="ovl-restore__hero">
        <Icon name="cloud-download" size={28} color="var(--accent-cyan)" />
        <div>
          <h2>Restore from cloud backup</h2>
          <p>Choose a provider and your separately saved recovery key. The key is never stored in the cloud.</p>
        </div>
      </div>

      {step === 'setup' ? (
        <>
          <label className="ovl-restore__field">
            <span>Cloud provider</span>
            <select
              value={providerId ?? ''}
              onChange={(event) => {
                setProviderId(event.target.value);
                setConnected(false);
              }}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.available}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ovl-restore__connection">
            <Badge tone={connected ? 'green' : 'neutral'}>{connected ? 'Connected' : 'Not connected'}</Badge>
            {connected ? null : (
              <Button
                variant="primary"
                disabled={providerId === null || connecting || descriptor?.available === false}
                onClick={() => {
                  if (providerId === null) return;
                  setConnecting(true);
                  setError(null);
                  void window.overlook.backup.connect({ providerId }).then((result) => {
                    setConnecting(false);
                    setConnected(result.ok);
                    if (!result.ok) setError({ reason: 'auth', message: result.reason ?? 'Connection failed.' });
                  });
                }}
              >
                {connecting ? 'Connecting…' : `Connect ${descriptor?.label ?? 'provider'}`}
              </Button>
            )}
            {descriptor?.available === false && descriptor.unavailableReason !== null ? <span>{descriptor.unavailableReason}</span> : null}
          </div>
          <div className="ovl-restore__keyrow">
            <Button
              icon="key-round"
              onClick={() => {
                void window.overlook.restore.pickKey().then(({ path }) => setKeyPath(path));
              }}
            >
              Choose recovery key
            </Button>
            <span className="mono-data">{keyPath === null ? 'NO KEY SELECTED' : fileName(keyPath)}</span>
          </div>
          <label className="ovl-restore__field">
            <span>Recovery-key password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={1024}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="ovl-restore__actions">
            {context === 'onboarding' ? (
              <>
                <Button variant="secondary" icon="folder-open" disabled={openingLocal} onClick={openExisting}>
                  {intl.formatMessage(openingLocal ? messages.openingExisting : messages.openExisting)}
                </Button>
                <Button variant="ghost" onClick={onStartNew}>
                  Start a new library
                </Button>
              </>
            ) : null}
            <Button variant="primary" disabled={!connected || keyPath === null || password === ''} onClick={discover}>
              Discover backups
            </Button>
          </div>
        </>
      ) : step === 'choose' ? (
        <>
          <div className="ovl-restore__sectionTitle">Available libraries</div>
          <div className="ovl-restore__libraries">
            {libraries.length === 0 && error === null ? <div className="ovl-restore__empty">Validating cloud libraries…</div> : null}
            {libraries.map((library) => (
              <LibraryCard
                key={library.libraryId}
                library={library}
                selected={library.libraryId === selectedId}
                onSelect={() => setSelectedId(library.libraryId)}
              />
            ))}
          </div>
          <div className="ovl-restore__actions">
            <Button variant="ghost" onClick={() => setStep('setup')}>
              Back
            </Button>
            <Button variant="primary" disabled={selectedId === null} onClick={() => setStep('confirm')}>
              Review restore
            </Button>
          </div>
        </>
      ) : step === 'confirm' && selected !== null ? (
        <>
          <div className="ovl-restore__warnings">
            <strong>{context === 'settings' ? 'This replaces the active library.' : 'Ready to restore this library.'}</strong>
            <ul>
              <li>Disk space is checked before any originals download.</li>
              <li>Downloads are staged, verified, and resumable after cancellation.</li>
              <li>The current library remains active unless the complete staged restore validates.</li>
              <li>Activation uses rollback-safe replacement, then Overlook relaunches.</li>
            </ul>
          </div>
          {context === 'settings' ? (
            <Checkbox
              checked={authorized}
              label="I understand that the active local library will be replaced after validation."
              onChange={setAuthorized}
            />
          ) : null}
          <div className="ovl-restore__actions">
            <Button variant="ghost" onClick={() => setStep('choose')}>
              Back
            </Button>
            <Button variant={context === 'settings' ? 'danger' : 'primary'} disabled={!authorized} onClick={run}>
              Restore {formatCount(selected.photos ?? 0)} photos
            </Button>
          </div>
        </>
      ) : step === 'running' ? (
        <div className="ovl-restore__running" aria-live="polite">
          <div className="ovl-restore__sectionTitle">{progress === null ? 'Preparing restore' : stageLabel(progress.stage)}</div>
          <ProgressBar
            value={progress?.done ?? 0}
            max={Math.max(progress?.total ?? 1, 1)}
            label={progress === null ? 'Starting' : stageLabel(progress.stage)}
            {...(progress === null ? {} : { detail: `${String(progress.done)} / ${String(progress.total)}` })}
          />
          <Button
            variant="secondary"
            disabled={progress?.stage === 'activating' || progress?.stage === 'complete'}
            onClick={() => void window.overlook.restore.cancel({})}
          >
            Cancel and keep staged progress
          </Button>
        </div>
      ) : (
        <div className="ovl-restore__complete" aria-live="polite">
          <Icon name="circle-check" size={28} color="var(--accent-green)" />
          <strong>Restore complete</strong>
          <span>{fallbackNotice ?? 'Overlook is relaunching with the restored library.'}</span>
        </div>
      )}

      {error === null ? null : (
        <div className="ovl-restore__error" role="alert">
          <strong>{error.message}</strong>
          <span>
            {error.reason === 'not-a-library'
              ? intl.formatMessage(messages.notLibraryHelp)
              : error.reason === 'already-registered'
                ? intl.formatMessage(messages.alreadyRegisteredHelp)
                : error.reason === 'local-open'
                  ? intl.formatMessage(messages.openFailedHelp)
                  : (ERROR_HELP[error.reason] ?? ERROR_HELP['io'])}
          </span>
        </div>
      )}
    </div>
  );
}
