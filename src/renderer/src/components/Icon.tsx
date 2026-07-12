import {
  Album,
  Aperture,
  Camera,
  Check,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudDownload,
  CloudUpload,
  Database,
  Download,
  Funnel,
  HardDrive,
  ImageOff,
  Info,
  KeyRound,
  LayoutGrid,
  List,
  Lock,
  MapPin,
  Minus,
  RefreshCw,
  Search,
  Settings2,
  Share,
  ShieldCheck,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { ReactElement } from 'react';

// The design system's fixed icon vocabulary (DS readme §ICONOGRAPHY) — using
// any other glyph is a type error, not a review comment. No emoji, no icon
// fonts, no ad-hoc SVGs, no CDN: lucide-react is bundled and tree-shaken.
export const ICON_NAMES = [
  'album',
  'aperture',
  'camera',
  'check',
  'cloud',
  'cloud-alert',
  'cloud-check',
  'cloud-download',
  'cloud-upload',
  'database',
  'download',
  'funnel',
  'hard-drive',
  'image-off',
  'info',
  'key-round',
  'layout-grid',
  'list',
  'lock',
  'map-pin',
  'minus',
  'refresh-cw',
  'search',
  'settings-2',
  'share',
  'shield-check',
  'square',
  'star',
  'trash-2',
  'triangle-alert',
  'x',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

// `satisfies` proves every vocabulary name has a glyph and no extras exist.
const ICONS = {
  album: Album,
  aperture: Aperture,
  camera: Camera,
  check: Check,
  cloud: Cloud,
  'cloud-alert': CloudAlert,
  'cloud-check': CloudCheck,
  'cloud-download': CloudDownload,
  'cloud-upload': CloudUpload,
  database: Database,
  download: Download,
  funnel: Funnel,
  'hard-drive': HardDrive,
  'image-off': ImageOff,
  info: Info,
  'key-round': KeyRound,
  'layout-grid': LayoutGrid,
  list: List,
  lock: Lock,
  'map-pin': MapPin,
  minus: Minus,
  'refresh-cw': RefreshCw,
  search: Search,
  'settings-2': Settings2,
  share: Share,
  'shield-check': ShieldCheck,
  square: Square,
  star: Star,
  'trash-2': Trash2,
  'triangle-alert': TriangleAlert,
  x: X,
} satisfies Record<IconName, typeof Album>;

// 14/16/20 are the DS's stated sizes; 11 (Badge glyphs), 12 (Chip remove),
// 13 (TitleBar controls, Chip glyphs), and 18 (lg Button) are the design
// mock's own additional usages, adopted as-is — as are the minus/square/x
// window-control glyphs above.
// 28 is the empty-state glyph size the design's LibraryGrid.jsx uses (#76).
export type IconSize = 11 | 12 | 13 | 14 | 16 | 18 | 20 | 28;

export interface IconProps {
  readonly name: IconName;
  readonly size?: IconSize;
  /** Defaults to currentColor so icons inherit text color/tokens. */
  readonly color?: string;
  /** 1.75 everywhere except Badge glyphs (2 at 11px) and Checkbox marks (3
   * at 11px) per the mock. */
  readonly strokeWidth?: 1.75 | 2 | 3;
}

export function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 1.75 }: IconProps): ReactElement {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={strokeWidth} color={color} aria-hidden style={{ flex: 'none' }} />;
}
