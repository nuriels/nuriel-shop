// ניווט אזור הניהול (שלב F2b, "Deep Lagoon & Champagne"):
//   • מחשב — סרגל צד כהה, בקבוצות (תפעול / המקום / האתר והערוצים / חשבון), עם ספירות (ממתינות,
//     ערוצים שדורשים בדיקה), כרטיס העסק למעלה וכפתור התנתקות למטה;
//   • טלפון — שורה תחתונה (לוח בקרה, יומן, הזמנות, יחידות) ו"עוד מסכים" — חלון עם כל השאר בקבוצות.
// בשני המקרים: <nav aria-label="ניווט ראשי"> אחד גלוי בכל רוחב מסך.
import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ExternalLink, LogOut, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  cn,
} from "@/platform/ui";
import {
  groupedNav,
  isNavActive,
  monogram,
  splitForMobile,
  type NavBadges,
  type NavItem,
} from "../lib/nav";
import { NAV_ICONS } from "./nav-icons";

function useNavActive(item: NavItem): boolean {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return isNavActive(item, pathname);
}

function Badge({ n, dark }: { n: number | undefined; dark?: boolean }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "ms-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
        dark
          ? "bg-[var(--hm-champagne-500)] text-[var(--hm-lagoon-900)]"
          : "bg-[var(--hm-warning-bg)] text-[var(--hm-warning)]",
      )}
    >
      {n}
      <span className="sr-only"> ממתינים לטיפול</span>
    </span>
  );
}

/** פריט בסרגל הצד (כהה) */
function SideItem({ item, badge }: { item: NavItem; badge: number | undefined }) {
  const Icon = NAV_ICONS[item.key];
  const active = useNavActive(item);
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--hm-champagne-500)]",
        active
          ? "bg-white/10 font-semibold text-white shadow-[inset_-3px_0_0_var(--hm-champagne-500)]"
          : "font-medium text-[var(--hm-sidebar-text)] hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0",
          active ? "text-[var(--hm-champagne-500)]" : "text-[var(--hm-sidebar-muted)]",
        )}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{item.label}</span>
      <Badge n={badge} dark />
    </Link>
  );
}

export function SideNav({
  items,
  badges,
  businessName,
  roleText,
  onSignOut,
}: {
  items: NavItem[];
  badges: NavBadges;
  businessName: string;
  roleText: string;
  onSignOut: () => void;
}) {
  return (
    // הרקע הכהה על כל גובה העמודה; הסרגל עצמו נשאר במקום בגלילה
    <div className="hidden bg-[var(--hm-lagoon-900)] md:block">
      <aside className="sticky top-0 flex h-dvh flex-col text-[var(--hm-sidebar-text)]">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center rounded-lg bg-[var(--hm-champagne-500)] font-display text-lg font-bold text-[var(--hm-lagoon-900)]"
          >
            N
          </span>
          <span className="leading-tight">
            <span className="block text-[13px] font-bold text-white" dir="ltr">
              Nuriel Hospitality
            </span>
            <span className="block text-[11px] text-[var(--hm-sidebar-muted)]">
              ניהול מקום האירוח
            </span>
          </span>
        </div>
        <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--hm-lagoon-500)] text-sm font-bold text-white"
          >
            {monogram(businessName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{businessName}</span>
            <span className="block text-xs text-[var(--hm-sidebar-muted)]">{roleText}</span>
          </span>
        </div>
        <nav aria-label="ניווט ראשי" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {groupedNav(items).map((g) => (
            <div key={g.key} className="mt-3 first:mt-0">
              <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-[var(--hm-sidebar-muted)]">
                {g.title}
              </p>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((item) => (
                  <li key={item.key}>
                    <SideItem item={item} badge={badges[item.key]} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={onSignOut}
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--hm-sidebar-text)] hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--hm-champagne-500)]"
          >
            <LogOut className="size-[18px] text-[var(--hm-sidebar-muted)]" aria-hidden="true" />
            התנתקות
          </button>
        </div>
      </aside>
    </div>
  );
}

/** פריט ברשימה בחלון "עוד" (בהיר) */
function SheetItem({
  item,
  badge,
  onNavigate,
}: {
  item: NavItem;
  badge: number | undefined;
  onNavigate: () => void;
}) {
  const Icon = NAV_ICONS[item.key];
  const active = useNavActive(item);
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium",
        active ? "bg-[var(--hm-lagoon-100)] text-[var(--hm-lagoon-900)]" : "hover:bg-muted",
      )}
    >
      <Icon className="size-5 shrink-0 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      <Badge n={badge} />
    </Link>
  );
}

/** פריט בשורה התחתונה (טלפון) */
function BarItem({ item, badge }: { item: NavItem; badge: number | undefined }) {
  const Icon = NAV_ICONS[item.key];
  const active = useNavActive(item);
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px]",
        active ? "font-bold text-[var(--hm-lagoon-900)]" : "font-medium text-[var(--hm-ink-2)]",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute top-0 h-0.5 w-8 rounded-full bg-[var(--hm-champagne-600)]"
        />
      )}
      <span className="relative">
        <Icon
          className={cn("size-5", active && "text-[var(--hm-lagoon-700)]")}
          aria-hidden="true"
        />
        {badge ? (
          <span className="absolute -top-1.5 -end-2 inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--hm-warning-dot)] px-1 text-[10px] font-bold text-[var(--hm-lagoon-900)]">
            {badge}
            <span className="sr-only"> ממתינים לטיפול</span>
          </span>
        ) : null}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

export function BottomNav({
  items,
  badges,
  siteOpen,
  onSignOut,
}: {
  items: NavItem[];
  badges: NavBadges;
  siteOpen: boolean;
  onSignOut: () => void;
}) {
  const { bar, more } = splitForMobile(items);
  // החלון נסגר כשבוחרים מסך — אחרת המסך החדש נפתח מאחוריו
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBadge = more.reduce((n, i) => n + (badges[i.key] ?? 0), 0);
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-18px_rgb(12_48_47/0.35)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {bar.map((item) => (
          <li key={item.key} className="flex flex-1">
            <BarItem item={item} badge={badges[item.key]} />
          </li>
        ))}
        <li className="flex flex-1">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger
              className="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-[var(--hm-ink-2)]"
              aria-label="עוד מסכים"
            >
              <span className="relative">
                <Menu className="size-5" aria-hidden="true" />
                {moreBadge > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1 -end-1 size-2 rounded-full bg-[var(--hm-warning-dot)]"
                  />
                )}
              </span>
              <span>עוד</span>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[85dvh] overflow-y-auto rounded-t-2xl"
              dir="rtl"
            >
              <SheetHeader className="text-start">
                <SheetTitle>עוד מסכים</SheetTitle>
                <SheetDescription>כל המסכים של ניהול העסק</SheetDescription>
              </SheetHeader>
              <div className="mt-2 flex flex-col gap-4 pb-4">
                {groupedNav(more).map((g) => (
                  <div key={g.key}>
                    <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground">
                      {g.title}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {g.items.map((item) => (
                        <li key={item.key}>
                          <SheetItem
                            item={item}
                            badge={badges[item.key]}
                            onNavigate={() => setMoreOpen(false)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="flex flex-col gap-1 border-t pt-3">
                  {siteOpen && (
                    <a
                      href="/stay"
                      target="_blank"
                      rel="noopener"
                      className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium hover:bg-muted"
                    >
                      <ExternalLink
                        className="size-5 text-[var(--hm-lagoon-500)]"
                        aria-hidden="true"
                      />
                      צפייה באתר
                      <span className="sr-only">(נפתח בחלון חדש)</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onSignOut();
                    }}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-start text-[15px] font-medium hover:bg-muted"
                  >
                    <LogOut className="size-5 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
                    התנתקות
                  </button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
