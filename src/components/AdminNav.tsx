import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  BadgePercent,
  BarChart3,
  Barcode,
  CreditCard,
  FileText,
  ClipboardCheck,
  ClipboardList,
  FolderTree,
  Gem,
  Gift,
  Globe,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  Lock,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  MessageSquareQuote,
  Package,
  PackageCheck,
  Puzzle,
  Receipt,
  Scale,
  ScanSearch,
  Settings,
  ShoppingCart,
  TicketPercent,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBackToClose } from "@/hooks/useBackToClose";
import { loadInboxCounts } from "@/lib/site-inbox";
import { SITE_INBOX_CHANGED } from "@/components/inbox/SiteInboxPanel";
import { showAdminTabInNav, type StaffRole } from "@/lib/permissions";
import { countPendingReviews } from "@/lib/reviews-data";
import { REVIEWS_CHANGED } from "@/lib/reviews";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Section = { value: string; label: string; icon: LucideIcon };

/**
 * תפריט הניהול — מקובץ לפי תחום. הערכים = ?tab= בכתובת (לא לשנות — קישורים קיימים).
 * חלק 33: כל עובד רואה רק את מה שמותר לתפקיד שלו (ADMIN_TAB_RULES ב-permissions.ts).
 */
export const ADMIN_SECTIONS: { title: string; items: Section[] }[] = [
  {
    title: "סקירה",
    items: [{ value: "dashboard", label: "לוח בקרה", icon: LayoutDashboard }],
  },
  {
    title: "הזמנות ולקוחות",
    items: [
      { value: "orders", label: "הזמנות", icon: ClipboardList },
      { value: "pos", label: "קופה מהירה", icon: Receipt },
      // המחסנאי (חלק 33): ליקוט + עדכון סטטוס משלוח, בלי מחירים
      { value: "picking", label: "ליקוט הזמנות", icon: PackageCheck },
      { value: "fulfillment", label: "סטטוס משלוחים", icon: Truck },
      { value: "inbox", label: "פניות וביטולי עסקה", icon: MessageSquare },
      { value: "users", label: "משתמשים", icon: Users },
      { value: "custom-prices", label: "מחירי לקוחות מיוחדים", icon: BadgePercent },
      { value: "performance", label: "ביצועי סוכנים ועובדים", icon: BarChart3 },
    ],
  },
  {
    title: "קטלוג ומלאי",
    items: [
      { value: "products", label: "מוצרים וקטגוריות", icon: Package },
      { value: "categories", label: "ניהול קטגוריות", icon: FolderTree },
      { value: "stock", label: "ספירת מלאי", icon: ClipboardCheck },
      { value: "stock-check", label: "בדיקת מלאי", icon: ScanSearch },
      { value: "labels", label: "מדבקות ברקוד", icon: Barcode },
      { value: "transfers", label: "העברה בין איתורים", icon: ArrowLeftRight },
      { value: "pending", label: "ממתינים לאישור", icon: Inbox },
    ],
  },
  {
    title: "מכירות",
    items: [
      { value: "promotions", label: "מתנות ומוצרי קופה", icon: Gift },
      { value: "coupons", label: "קופונים", icon: TicketPercent },
      { value: "reviews", label: "ביקורות לקוחות", icon: MessageSquareQuote },
      { value: "abandoned", label: "עגלות נטושות", icon: ShoppingCart },
      { value: "shipping", label: "משלוחים", icon: Truck },
    ],
  },
  {
    title: "האתר",
    items: [
      { value: "home", label: "עיצוב מסך הבית", icon: LayoutTemplate },
      { value: "site", label: "הגדרות אתר", icon: Settings },
      { value: "legal", label: "עמודים משפטיים", icon: Scale },
      { value: "pages", label: "עמודי תוכן", icon: FileText },
      { value: "marketing", label: "שיווק ואינטגרציות", icon: Megaphone },
      { value: "email", label: "התראות מייל", icon: Mail },
      { value: "domain", label: "דומיין פרטי", icon: Globe },
    ],
  },
  {
    title: "חשבון",
    items: [
      { value: "staff", label: "צוות והרשאות", icon: UserCog },
      { value: "addons", label: "שדרוגים ותוספים", icon: Puzzle },
      { value: "billing", label: "המנוי שלי", icon: Gem },
      { value: "support", label: "תמיכה ועזרה", icon: LifeBuoy },
    ],
  },
];

/** הלשוניות שפתוחות גם כשהמנוי של החנות פג (חלק 13) */
export const EXPIRED_ALLOWED_TABS = ["billing", "support"];

export function adminSectionLabel(value: string): string {
  for (const group of ADMIN_SECTIONS) {
    const found = group.items.find((item) => item.value === value);
    if (found) return found.label;
  }
  return "ניהול";
}

/** כמה בקשות מוצר ממתינות לטיפול — מוצג ליד "ממתינים לאישור" */
function usePendingCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const { count: total } = await supabase
        .from("pending_products")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (alive) setCount(total ?? 0);
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return count;
}

/** כמה פניות תמיכה עם תשובה שלא נקראה — מוצג ליד "תמיכה ועזרה" */
function useSupportUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const { data } = await supabase.rpc("support_unread_count");
      if (alive) setCount(Number(data ?? 0) || 0);
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return count;
}

/** פניות חדשות מהאתר + הודעות ביטול פתוחות — מוצג ליד "פניות וביטולי עסקה" */
function useInboxCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const counts = await loadInboxCounts();
      if (alive) setCount(counts.contact + counts.cancellations);
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onChange = () => void load();
    window.addEventListener(SITE_INBOX_CHANGED, onChange);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(SITE_INBOX_CHANGED, onChange);
    };
  }, [enabled]);
  return count;
}

/** חלק 34: כמה ביקורות ממתינות לאישור — מוצג ליד "ביקורות לקוחות" */
function usePendingReviews(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const total = await countPendingReviews();
      if (alive) setCount(total);
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onChange = () => void load();
    window.addEventListener(REVIEWS_CHANGED, onChange);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(REVIEWS_CHANGED, onChange);
    };
  }, [enabled]);
  return count;
}

/** הקבוצות והלשוניות שהתפקיד רואה בתפריט (קבוצה ריקה — לא מוצגת) */
function visibleAdminSections(staffRole: StaffRole | null): typeof ADMIN_SECTIONS {
  return ADMIN_SECTIONS.map((group) => ({
    ...group,
    items: group.items.filter((item) => showAdminTabInNav(staffRole, item.value)),
  })).filter((group) => group.items.length > 0);
}

function NavList({
  value,
  onChange,
  locked,
  staffRole,
}: {
  value: string;
  onChange: (next: string) => void;
  locked: boolean;
  staffRole: StaffRole | null;
}) {
  const sections = visibleAdminSections(staffRole);
  const has = (tab: string) => sections.some((group) => group.items.some((i) => i.value === tab));
  // המונים רק למי שרואה את הלשונית (לקופאי / מחסנאי — בלי שאילתות מיותרות)
  const pending = usePendingCount(has("pending"));
  const supportUnread = useSupportUnread(has("support"));
  const inboxCount = useInboxCount(has("inbox"));
  const pendingReviews = usePendingReviews(has("reviews"));
  return (
    <div className="space-y-4">
      {sections.map((group) => (
        <div key={group.title} className="space-y-1">
          <p className="px-3 text-xs font-semibold text-muted-foreground">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map(({ value: item, label, icon: Icon }) => {
              const active = item === value;
              // המנוי פג: רק "המנוי שלי" ו"תמיכה ועזרה" פתוחים
              const disabled = locked && !EXPIRED_ALLOWED_TABS.includes(item);
              const badge =
                item === "pending" && pending > 0
                  ? pending
                  : item === "support" && supportUnread > 0
                    ? supportUnread
                    : item === "inbox" && inboxCount > 0
                      ? inboxCount
                      : item === "reviews" && pendingReviews > 0
                        ? pendingReviews
                        : null;
              return (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => onChange(item)}
                    disabled={disabled}
                    aria-current={active ? "page" : undefined}
                    title={disabled ? "המנוי הסתיים — חדשו את המנוי כדי לחזור לניהול" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 ${
                      active
                        ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                        : "text-foreground hover:bg-secondary disabled:hover:bg-transparent"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {disabled && <Lock className="size-3.5 shrink-0" aria-hidden="true" />}
                    {badge !== null && (
                      <span
                        className={`numeric rounded-full px-1.5 text-xs font-bold ${
                          active ? "bg-primary-foreground/20" : "bg-accent text-accent-foreground"
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * תפריט הניהול: בצד ימין במחשב (נשאר במקום בגלילה), ובטלפון — כפתור שפותח
 * מגירה מימין. "חזור" בטלפון סוגר את המגירה.
 */
export function AdminNav({
  value,
  onChange,
  locked = false,
  staffRole,
}: {
  value: string;
  onChange: (next: string) => void;
  /** המנוי פג — כל הלשוניות נעולות חוץ מ"המנוי שלי" ו"תמיכה ועזרה" */
  locked?: boolean;
  /** חלק 33: התפקיד בצוות — התפריט מציג רק את מה שמותר לו */
  staffRole: StaffRole | null;
}) {
  const [open, setOpen] = useState(false);
  useBackToClose(open, () => setOpen(false));
  const pick = (next: string) => {
    setOpen(false);
    onChange(next);
  };
  return (
    <>
      <aside className="hidden md:block">
        <nav
          aria-label="תפריט ניהול"
          className="sticky top-[calc(var(--site-header-h,0px)+1rem)] rounded-xl border border-border bg-card p-2 py-3 shadow-card"
        >
          <NavList value={value} onChange={onChange} locked={locked} staffRole={staffRole} />
        </nav>
      </aside>

      <div className="md:hidden">
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          onClick={() => setOpen(true)}
          aria-label="פתיחת תפריט הניהול"
        >
          <span className="flex items-center gap-2">
            <Menu className="size-4" aria-hidden="true" />
            תפריט ניהול
          </span>
          <span className="truncate font-semibold">{adminSectionLabel(value)}</span>
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" dir="rtl" className="w-72 overflow-y-auto p-3 text-right">
            <SheetHeader className="mb-3 ps-10 text-right">
              <SheetTitle>תפריט ניהול</SheetTitle>
            </SheetHeader>
            <nav aria-label="תפריט ניהול">
              <NavList value={value} onChange={pick} locked={locked} staffRole={staffRole} />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
