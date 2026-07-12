import {
  Album,
  Aperture,
  Camera,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudDownload,
  CloudUpload,
  Database,
  Download,
  Funnel,
  HardDrive,
  Info,
  KeyRound,
  LayoutGrid,
  List,
  Lock,
  MapPin,
  RefreshCw,
  Search,
  Settings2,
  Share,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react';
import type { ReactElement } from 'react';

// The design system's fixed icon vocabulary (DS readme §ICONOGRAPHY) — using
// any other glyph is a type error, not a review comment. No emoji, no icon
// fonts, no ad-hoc SVGs, no CDN: lucide-react is bundled and tree-shaken.
export const ICON_NAMES = [
  'album',
  'aperture',
  'camera',
  'cloud',
  'cloud-alert',
  'cloud-check',
  'cloud-download',
  'cloud-upload',
  'database',
  'download',
  'funnel',
  'hard-drive',
  'info',
  'key-round',
  'layout-grid',
  'list',
  'lock',
  'map-pin',
  'refresh-cw',
  'search',
  'settings-2',
  'share',
  'shield-check',
  'star',
  'trash-2',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

// `satisfies` proves every vocabulary name has a glyph and no extras exist.
const ICONS = {
  album: Album,
  aperture: Aperture,
  camera: Camera,
  cloud: Cloud,
  'cloud-alert': CloudAlert,
  'cloud-check': CloudCheck,
  'cloud-download': CloudDownload,
  'cloud-upload': CloudUpload,
  database: Database,
  download: Download,
  funnel: Funnel,
  'hard-drive': HardDrive,
  info: Info,
  'key-round': KeyRound,
  'layout-grid': LayoutGrid,
  list: List,
  lock: Lock,
  'map-pin': MapPin,
  'refresh-cw': RefreshCw,
  search: Search,
  'settings-2': Settings2,
  share: Share,
  'shield-check': ShieldCheck,
  star: Star,
  'trash-2': Trash2,
} satisfies Record<IconName, typeof Album>;

export type IconSize = 14 | 16 | 20;

export interface IconProps {
  readonly name: IconName;
  /** DS sizes only: 14 (dense/mono rows), 16 (default UI), 20 (toolbar). */
  readonly size?: IconSize;
  /** Defaults to currentColor so icons inherit text color/tokens. */
  readonly color?: string;
}

export function Icon({ name, size = 16, color = 'currentColor' }: IconProps): ReactElement {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.75} color={color} aria-hidden style={{ flex: 'none' }} />;
}
