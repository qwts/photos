import type { ReactElement } from 'react';

import { useFormats } from '../i18n/use-formats.js';
import type { LibraryStats } from '../../../shared/library/types.js';
import { Icon } from '../components/Icon';
import { useAppState } from '../state/app-state-context';

// The 26px mono strip (#81) per the design's StatusBar.jsx — always tells
// the truth about the library. The sync side flips on pendingCount events;
// the real backup engine (and real lastBackup stamps) land with M08.
export function StatusBar({ stats }: { readonly stats: LibraryStats | null }): ReactElement {
  const { formatBytes, formatCount } = useFormats();
  const state = useAppState();
  const syncing = state.pendingCount > 0;
  const provider = state.providerLabel;
  return (
    <footer className="ovl-statusbar">
      <span data-testid="statusbar-left">{stats === null ? '—' : `${formatCount(stats.photos)} PHOTOS · ${formatBytes(stats.bytes)}`}</span>
      <span className="ovl-statusbar__spacer" />
      {!state.providerConnected ? (
        // Disconnected (#239): a faint statement of fact, never a fabricated
        // backed-up state.
        <span className="ovl-statusbar__item" data-testid="sync-state">
          <Icon name="cloud-off" size={12} strokeWidth={2} />
          {provider} NOT CONNECTED
        </span>
      ) : syncing ? (
        <span className="ovl-statusbar__item ovl-statusbar__item--amber" data-testid="sync-state">
          <span className="ovl-statusbar__spin">
            <Icon name="refresh-cw" size={11} strokeWidth={2} />
          </span>
          ENCRYPTING {formatCount(state.pendingCount)} → {provider}
        </span>
      ) : (
        <span className="ovl-statusbar__item ovl-statusbar__item--green" data-testid="sync-state">
          <Icon name="cloud-check" size={12} strokeWidth={2} />
          ALL BACKED UP · {state.lastBackupLabel}
        </span>
      )}
      <span className="ovl-statusbar__item ovl-statusbar__item--green">
        <Icon name="lock" size={11} strokeWidth={2} />
        AES-256
      </span>
    </footer>
  );
}
