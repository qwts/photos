import {
  Album,
  Aperture,
  ArrowLeft,
  Camera,
  Check,
  ChevronLeft,
  CircleCheck,
  ChevronRight,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudDownload,
  CloudUpload,
  Database,
  Download,
  Folder,
  Funnel,
  Grid2x2,
  Grid3x3,
  HardDrive,
  Image,
  ImageOff,
  Images,
  Info,
  KeyRound,
  Plus,
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
  SlidersHorizontal,
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
  'arrow-left',
  'camera',
  'check',
  'chevron-left',
  'chevron-right',
  'circle-check',
  'folder',
  'cloud',
  'cloud-alert',
  'cloud-check',
  'cloud-download',
  'cloud-upload',
  'database',
  'download',
  'funnel',
  'grid-2x2',
  'grid-3x3',
  'hard-drive',
  'image',
  'image-off',
  'images',
  'info',
  'key-round',
  'layout-grid',
  'list',
  'lock',
  'map-pin',
  'minus',
  'plus',
  'refresh-cw',
  'search',
  'settings-2',
  'share',
  'shield-check',
  'sliders-horizontal',
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
  'arrow-left': ArrowLeft,
  camera: Camera,
  check: Check,
  'chevron-left': ChevronLeft,
  'circle-check': CircleCheck,
  'chevron-right': ChevronRight,
  cloud: Cloud,
  'cloud-alert': CloudAlert,
  'cloud-check': CloudCheck,
  'cloud-download': CloudDownload,
  'cloud-upload': CloudUpload,
  database: Database,
  download: Download,
  folder: Folder,
  funnel: Funnel,
  'grid-2x2': Grid2x2,
  'grid-3x3': Grid3x3,
  'hard-drive': HardDrive,
  image: Image,
  'image-off': ImageOff,
  images: Images,
  info: Info,
  'key-round': KeyRound,
  'layout-grid': LayoutGrid,
  list: List,
  lock: Lock,
  'map-pin': MapPin,
  minus: Minus,
  plus: Plus,
  'refresh-cw': RefreshCw,
  search: Search,
  'settings-2': Settings2,
  share: Share,
  'shield-check': ShieldCheck,
  'sliders-horizontal': SlidersHorizontal,
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
// 15 and 28 come from the design's own Toolbar.jsx / LibraryGrid.jsx usage.
export type IconSize = 11 | 12 | 13 | 14 | 15 | 16 | 18 | 20 | 28;

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
