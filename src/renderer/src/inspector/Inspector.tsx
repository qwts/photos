import type { ReactElement } from 'react';

import { formatBytes } from '../../../shared/library/format.js';
import { thumbUrl } from '../../../shared/library/thumb-url.js';
import { Badge } from '../components/Badge';
import { MetadataRow } from '../components/MetadataRow';
import { StatusGlyph } from '../components/StatusGlyph';
import type { PhotoRecord, SyncStatus } from '../../../shared/library/types.js';

import './inspector.css';

// Inspector (#94, README §4): the 280px right-docked truth panel for the
// focused photo. Every value comes from the real record — missing EXIF rows
// are OMITTED, never fabricated (Content voice), and the cipher row reads
// the photo's actual key id.

const STATUS_TEXT: Record<SyncStatus, string> = {
  local: 'LOCAL ONLY — NOT BACKED UP',
  // The mock appends "· 2H AGO" — a last-sync timestamp the ledger doesn't
  // expose yet (M08 adds it); until then the row states only what is true.
  synced: 'ENCRYPTED · PCLOUD',
  syncing: 'ENCRYPTING → PCLOUD…',
  offloaded: 'OFFLOADED — ORIGINAL IN PCLOUD',
};

const STATUS_TONE: Record<SyncStatus, string> = {
  local: 'var(--text-muted)',
  synced: 'var(--accent-green)',
  syncing: 'var(--accent-amber)',
  offloaded: 'var(--accent-amber)',
};

function Section({ title, children }: { readonly title: string; readonly children: ReactElement | (ReactElement | null)[] }): ReactElement {
  return (
    <div className="ovl-inspector__section">
      <div className="ovl-inspector__sectionTitle">{title}</div>
      {children}
    </div>
  );
}

export interface InspectorProps {
  /** The focused photo — lightbox photo, else the single grid selection. */
  readonly photo: PhotoRecord | null;
}

export function Inspector({ photo }: InspectorProps): ReactElement {
  if (photo === null) {
    return (
      <div className="ovl-inspector ovl-inspector--empty" data-testid="inspector">
        <span className="mono-data">Select a photo</span>
      </div>
    );
  }
  const megapixels = ((photo.width * photo.height) / 1_000_000).toFixed(1);
  const exposure = [
    photo.aperture === null ? null : `ƒ/${photo.aperture}`,
    photo.shutter === null ? null : `${photo.shutter}S`,
    photo.iso === null ? null : `ISO ${String(photo.iso)}`,
  ].filter((part) => part !== null);
  const dateLine = [(photo.takenAt ?? photo.importedAt).slice(0, 10), photo.place?.toUpperCase() ?? null]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <div className="ovl-inspector" data-testid="inspector">
      <div className="ovl-inspector__header">
        <img className="ovl-inspector__thumb" src={thumbUrl(photo.id)} alt="" />
        <div className="ovl-inspector__headText">
          <div className="ovl-inspector__name">{photo.fileName}</div>
          <div className="ovl-inspector__date mono-data">{dateLine}</div>
        </div>
        <StatusGlyph state={photo.syncState} />
      </div>
      <Section title="Badges">
        <div className="ovl-inspector__badges">
          <Badge tone="green" icon="lock">
            Encrypted
          </Badge>
          <Badge>{photo.fileKind === 'raw' ? 'RAW' : photo.fileKind.toUpperCase()}</Badge>
          {photo.favorite ? (
            <Badge tone="cyan" icon="star">
              Favorite
            </Badge>
          ) : null}
        </div>
      </Section>
      <Section title="Capture">
        {photo.camera === null ? null : <MetadataRow label="Camera" value={photo.camera} />}
        {photo.lens === null ? null : <MetadataRow label="Lens" value={photo.lens} />}
        {exposure.length === 0 ? null : <MetadataRow label="Exposure" value={exposure.join(' · ')} />}
        {photo.focalLength === null ? null : <MetadataRow label="Focal" value={`${String(photo.focalLength)}MM`} />}
      </Section>
      <Section title="File">
        <MetadataRow label="Dimensions" value={`${String(photo.width)}×${String(photo.height)} · ${megapixels} MP`} />
        <MetadataRow label="Size" value={formatBytes(photo.bytes)} />
        <MetadataRow label="Imported" value={`${photo.importedAt.slice(0, 10)} · ${photo.importSource.toUpperCase()}`} />
      </Section>
      <Section title="Backup">
        <MetadataRow label="State" value={STATUS_TEXT[photo.syncState]} tone={STATUS_TONE[photo.syncState]} />
        <MetadataRow label="Cipher" value={`AES-256-GCM · KEY #${String(photo.keyId)}`} />
      </Section>
    </div>
  );
}
