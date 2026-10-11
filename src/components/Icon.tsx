import {
  Activity,
  Battery,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Droplets,
  Flame,
  Info,
  Layers,
  LayoutDashboard,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Search,
  Thermometer,
  Trees,
  TriangleAlert,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react-native';

import { iconSize as iconTokens } from '@/theme';

/**
 * Local Lucide icons (ISC). They render through react-native-svg and do not
 * fetch artwork at runtime. See assets/icons/LICENSE-lucide.txt.
 */
const icons = {
  activity: Activity,
  alert: TriangleAlert,
  back: ChevronLeft,
  battery: Battery,
  chevron: ChevronRight,
  clipboard: ClipboardList,
  close: X,
  dashboard: LayoutDashboard,
  flame: Flame,
  humidity: Droplets,
  info: Info,
  layers: Layers,
  locate: LocateFixed,
  map: MapIcon,
  minus: Minus,
  plus: Plus,
  search: Search,
  signal: Wifi,
  temperature: Thermometer,
  trees: Trees,
  unknown: CircleHelp,
  offline: WifiOff,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

type IconProps = {
  name: IconName;
  color: string;
  size?: number;
};

export function Icon({ name, color, size = iconTokens.md }: IconProps) {
  const Glyph = icons[name];
  return <Glyph color={color} size={size} strokeWidth={2} />;
}
