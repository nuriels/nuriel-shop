import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  BadgePercent,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  FolderTree,
  Gift,
  Globe,
  Inbox,
  LayoutTemplate,
  Mail,
  Menu,
  Package,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBackToClose } from "@/hooks/useBackToClose";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Section = { value: string; label: string; icon: LucideIcon };

/** תפריט הניהול — מקובץ לפי תחום. הערכים = ?tab= בכתובת (לא לשנות — קישורים קיימים) */
export const ADMIN_SECTIONS: { title: string; items: Section[] }[] = [
  {
    title: "הזמנות ולקוחות",
    items: [
      { value: "orders", label: "הזמנות", icon: ClipboardList },
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
      { value: "transfers", label: "העברה בין איתורים", icon: ArrowLeftRight },
      { value: "pending", label: "ממתינים לאישור", icon: Inbox },
    ],
  },
  {
    title: "מכירות",
    items: [{ value: "promotions", label: "מתנות ומוצרי קופה", icon: Gift }],
  },
  {
    title: "האתר",
    items: [
      { value: "home", label: "עיצוב מסך הבית", icon: LayoutTemplate },
      { value: "site", label: "הגדרות אתר", icon: Settings },
      { value: "email", label: "הגדרות מייל", icon: Mail },
      { value: "domain", label: "דומיין משלכם", icon: Globe },
    ],
  },
];

export function adminSectionLabel(value: string): string {
  for (const group of ADMIN_SECTIONS) {
    const found = group.items.find((item) => item.value === value);
    if (found) return found.label;
  }
  return "ניהול";
}

/** כמה בקשות מוצר ממתינות לטיפול — מוצג ליד "ממתינים לאישור" */
function usePendingCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
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
  }, []);
  return count;
}

function NavList({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const pending = usePendingCount();
  return (
    <div className="space-y-4">
      {ADMIN_SECTIONS.map((group) => (
        <div key={group.title} className="space-y-1">
          <p className="px-3 text-xs font-semibold text-muted-foreground">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map(({ value: item, label, icon: Icon }) => {
              const active = item === value;
              const badge = item === "pending" && pending > 0 ? pending : null;
              return (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => onChange(item)}
                    aria-current={active ? "page" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                        : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
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
export function AdminNav({ value, onChange }: { value: string; onChange: (next: string) => void }) {
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
          <NavList value={value} onChange={onChange} />
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
              <NavList value={value} onChange={pick} />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
