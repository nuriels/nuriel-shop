// האייקון של כל מסך בניווט ובחיפוש המהיר (שלב F2b)
import {
  BedDouble,
  CalendarCheck,
  CalendarDays,
  FileText,
  Images,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Palette,
  Settings,
  Share2,
  Tag,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "../lib/nav";

export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  bookings: CalendarCheck,
  units: BedDouble,
  photos: Images,
  policies: FileText,
  pricing: Tag,
  guests: Users,
  emails: Mail,
  channels: Share2,
  website: Palette,
  settings: Settings,
  team: UserCog,
  support: LifeBuoy,
};
