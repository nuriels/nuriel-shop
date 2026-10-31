// ניווט אזור הניהול: בצד (מחשב) ובשורה תחתונה + "עוד" (טלפון). מסכים שעוד לא
// נבנו מוצגים כ"בקרוב" — לא קישורים.
import { Link } from "@tanstack/react-router";
import {
  BedDouble,
  CalendarCheck,
  LayoutDashboard,
  Mail,
  Menu,
  Settings,
  Tag,
  Users,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  cn,
} from "@/platform/ui";
import { splitForMobile, type NavItem, type NavKey } from "../lib/nav";

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  bookings: CalendarCheck,
  units: BedDouble,
  pricing: Tag,
  guests: Users,
  emails: Mail,
  settings: Settings,
  team: UserCog,
};

// (span ולא Badge: ה-Badge המשותף הוא div, ואסור div בתוך span)
function SoonBadge() {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
      בקרוב
    </span>
  );
}

/** פריט ברשימה (צד / תפריט "עוד") */
function ListItem({ item }: { item: NavItem }) {
  const Icon = ICONS[item.key];
  const base = "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm";
  if (!item.to) {
    return (
      <span aria-disabled="true" className={cn(base, "text-muted-foreground")}>
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{item.label}</span>
        <SoonBadge />
      </span>
    );
  }
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: true }}
      className={cn(base, "font-medium hover:bg-muted")}
      activeProps={{ className: "bg-primary/10 text-primary", "aria-current": "page" }}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
    </Link>
  );
}

export function SideNav({ items, businessName }: { items: NavItem[]; businessName: string }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-e bg-card p-4 md:flex">
      <div className="px-3 pt-2">
        <p className="text-xs text-muted-foreground">ניהול העסק</p>
        <p className="truncate text-lg font-semibold">{businessName}</p>
      </div>
      <nav aria-label="ניווט ראשי">
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.key}>
              <ListItem item={item} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

/** פריט בשורה התחתונה (טלפון) */
function BarItem({ item }: { item: NavItem }) {
  const Icon = ICONS[item.key];
  const base = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px]";
  if (!item.to) {
    return (
      <span aria-disabled="true" className={cn(base, "text-muted-foreground")}>
        <Icon className="size-5" aria-hidden="true" />
        <span>{item.label}</span>
        <span className="sr-only">(בקרוב)</span>
      </span>
    );
  }
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: true }}
      className={cn(base, "font-medium text-foreground")}
      activeProps={{ className: "text-primary", "aria-current": "page" }}
    >
      <Icon className="size-5" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const { bar, more } = splitForMobile(items);
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex">
        {bar.map((item) => (
          <li key={item.key} className="flex flex-1">
            <BarItem item={item} />
          </li>
        ))}
        {more.length > 0 && (
          <li className="flex flex-1">
            <Sheet>
              <SheetTrigger
                className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium"
                aria-label="עוד מסכים"
              >
                <Menu className="size-5" aria-hidden="true" />
                <span>עוד</span>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
                <SheetHeader className="text-start">
                  <SheetTitle>עוד מסכים</SheetTitle>
                  <SheetDescription>המסכים שמסומנים "בקרוב" ייפתחו בשלבים הבאים.</SheetDescription>
                </SheetHeader>
                <ul className="mt-4 flex flex-col gap-1">
                  {more.map((item) => (
                    <li key={item.key}>
                      <ListItem item={item} />
                    </li>
                  ))}
                </ul>
              </SheetContent>
            </Sheet>
          </li>
        )}
      </ul>
    </nav>
  );
}
