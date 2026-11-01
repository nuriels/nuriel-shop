// הסרגל העליון של אזור הניהול (שלב F2b): שם המסך (בטלפון — שם העסק והתפקיד), חיפוש מהיר
// (Ctrl+K), "+ חדש", פעמון "דורש טיפול" (אותם נתונים כמו בלוח הבקרה), וצפייה באתר.
// כל פעולה מוצגת רק למי שמורשה למסך שהיא פותחת; ההרשאה עצמה נאכפת במסד.
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Ban,
  BedDouble,
  Bell,
  CalendarPlus,
  CircleCheckBig,
  ExternalLink,
  Images,
  Plus,
  Search,
} from "lucide-react";
import { useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@/platform/ui";
import { sortTasks, taskView } from "../dashboard/model";
import { currentNav, type NavItem } from "../lib/nav";
import { useManagement } from "./management-context";
import { useDashboardTasks } from "./tasks";

export function TopBar({
  items,
  roleText,
  onSearch,
}: {
  items: NavItem[];
  roleText: string;
  onSearch: () => void;
}) {
  const ctx = useManagement();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = currentNav(items, pathname);
  return (
    <header className="sticky top-0 z-30 border-b bg-[color-mix(in_srgb,var(--background)_88%,transparent)] backdrop-blur">
      <div className="flex min-h-16 items-center gap-2 px-4 md:px-8">
        <div className="min-w-0 flex-1">
          {/* טלפון: שם העסק; מחשב: העסק / המסך הנוכחי. התפקיד — פעם אחת בעמוד, בכל רוחב */}
          <p className="truncate text-[15px] font-bold text-[var(--hm-lagoon-900)] md:hidden">
            {ctx.business.name}
          </p>
          <p className="hidden truncate text-sm text-muted-foreground md:block">
            <span>{ctx.business.name}</span>
            {current && current.key !== "dashboard" && (
              <>
                <span aria-hidden="true" className="mx-1.5 text-[var(--hm-line-soft)]">
                  /
                </span>
                <span className="font-semibold text-foreground">{current.label}</span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{roleText}</p>
        </div>
        <button
          type="button"
          onClick={onSearch}
          className="hidden min-h-10 w-56 items-center gap-2 rounded-xl border bg-card px-3 text-sm text-muted-foreground shadow-[var(--hm-shadow-card)] hover:border-[var(--hm-lagoon-500)] lg:flex"
          aria-keyshortcuts="Control+K"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="flex-1 text-start">חיפוש</span>
          <kbd dir="ltr" className="rounded border bg-muted px-1.5 text-[11px] font-medium">
            Ctrl K
          </kbd>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 lg:hidden"
          onClick={onSearch}
          aria-label="חיפוש"
        >
          <Search className="size-5" aria-hidden="true" />
        </Button>
        <NewMenu />
        {ctx.permissions["bookings"] && <TasksBell />}
        {ctx.flags.frontend && (
          <a
            href="/stay"
            target="_blank"
            rel="noopener"
            className="hidden min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-[var(--hm-lagoon-500)] hover:bg-[var(--hm-lagoon-100)] md:inline-flex"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            צפייה באתר
            <span className="sr-only">(נפתח בחלון חדש)</span>
          </a>
        )}
      </div>
    </header>
  );
}

// ---------- "+ חדש" ----------

function NewMenu() {
  const ctx = useManagement();
  const navigate = useNavigate();
  const p = ctx.permissions;
  const items = [
    p["bookings"] && {
      key: "booking",
      label: "הזמנה חדשה",
      icon: CalendarPlus,
      go: () => void navigate({ to: "/manage/bookings/new" }),
    },
    p["bookings"] && {
      key: "block",
      label: "חסימת תאריכים",
      icon: Ban,
      go: () => void navigate({ to: "/manage/calendar", search: { block: "1" } }),
    },
    p["catalog"] && {
      key: "unit",
      label: "יחידה חדשה",
      icon: BedDouble,
      go: () => void navigate({ to: "/manage/units", search: { add: "unit" } }),
    },
    p["media"] && {
      key: "photos",
      label: "העלאת תמונות",
      icon: Images,
      go: () => void navigate({ to: "/manage/photos" }),
    },
  ].filter(Boolean) as { key: string; label: string; icon: typeof Plus; go: () => void }[];
  if (items.length === 0) return null;
  return (
    <DropdownMenu dir="rtl" modal={false}>
      <DropdownMenuTrigger asChild>
        {/* השם הנגיש = הטקסט הנראה ("חדש"); בטלפון רק האייקון נראה והטקסט לקוראי מסך (WCAG 2.5.3) */}
        <Button className="min-h-10 gap-1.5 rounded-xl px-3 shadow-sm">
          <Plus className="size-4" aria-hidden="true" />
          <span className="max-sm:sr-only">חדש</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>יצירה חדשה</DropdownMenuLabel>
        {items.map((i) => (
          <DropdownMenuItem key={i.key} onSelect={i.go} className="min-h-10 gap-2">
            <i.icon className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
            {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- פעמון "דורש טיפול" ----------

function TasksBell() {
  const [open, setOpen] = useState(false);
  const query = useDashboardTasks(true);
  const tasks = query.data ? sortTasks(query.data.items) : [];
  const count = query.data?.count ?? 0;
  const urgent = tasks.some((t) => t.severity === "high");
  const now = Date.now();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-11"
          aria-label={count ? `דורש טיפול: ${count}` : "דורש טיפול — אין משימות"}
        >
          <Bell className="size-5" aria-hidden="true" />
          {count > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-1.5 end-1.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                urgent
                  ? "bg-[var(--hm-danger)] text-white"
                  : "bg-[var(--hm-champagne-500)] text-[var(--hm-lagoon-900)]",
              )}
            >
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" dir="rtl">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-bold">דורש טיפול</p>
          <p className="text-xs text-muted-foreground">מתעדכן כל דקה</p>
        </div>
        {tasks.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--hm-success)]">
            <CircleCheckBig className="size-5" aria-hidden="true" />
            הכול מטופל — אין משימות פתוחות.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {tasks.map((t) => {
              const v = taskView(t, now);
              return (
                <li key={t.kind}>
                  <Link
                    {...v.link}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 flex-col justify-center px-4 py-2 hover:bg-[var(--hm-surface-2)]"
                  >
                    <span className="text-sm font-semibold">{v.title}</span>
                    {v.detail && <span className="text-xs text-muted-foreground">{v.detail}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t p-2">
          <Link
            to="/manage"
            onClick={() => setOpen(false)}
            className="flex min-h-10 items-center justify-center rounded-lg text-sm font-semibold text-[var(--hm-lagoon-500)] hover:bg-[var(--hm-lagoon-100)]"
          >
            ללוח הבקרה
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
