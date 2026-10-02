import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SideGroup<T extends string> = {
  id: T;
  label: string;
  count: number;
  icon: LucideIcon;
  /** מספר מודגש בפליז — דורש טיפול (למשל ממתינות לאישור) */
  attention?: boolean;
  /** קו מפריד לפני הפריט */
  divider?: boolean;
  /** כותרת קטנה לפני הפריט (למשל "סוכנים") — במחשב בלבד */
  section?: string;
  /** שורת משנה קטנה מתחת לשם (למשל סכום) — במחשב בלבד */
  sublabel?: string;
};

/**
 * סרגל קבוצות בצד ימין — אותו סגנון כמו עץ הקטגוריות וקבוצות המשתמשים.
 * במחשב: סרגל קבוע משמאל לתוכן (בצד ימין ב-RTL). בטלפון: שורת כפתורים
 * שאפשר לגלול הצידה, מעל התוכן.
 */
export function GroupSidebarLayout<T extends string>({
  title,
  groups,
  value,
  onChange,
  children,
}: {
  title: string;
  groups: SideGroup<T>[];
  value: T;
  onChange: (next: T) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <aside className="hidden lg:sticky lg:top-24 lg:block">
        <div className="rounded-xl border border-border bg-card p-3 shadow-card">
          <h3 className="mb-2 px-2 font-display text-lg text-foreground">{title}</h3>
          <nav aria-label={title} className="space-y-0.5">
            {groups.map((group) => {
              const active = group.id === value;
              const Icon = group.icon;
              return (
                <div key={group.id}>
                  {group.divider && (
                    <div className="mx-2 my-2 border-t border-border" aria-hidden />
                  )}
                  {group.section && (
                    <p className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                      {group.section}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(group.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md border-s-[3px] py-2 pe-2 ps-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-accent bg-secondary font-semibold text-foreground"
                        : "border-transparent text-foreground/85 hover:bg-secondary/60",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 text-start">
                        <span className="block truncate">{group.label}</span>
                        {group.sublabel && (
                          <span className="numeric block truncate text-xs font-normal text-muted-foreground">
                            {group.sublabel}
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "numeric min-w-6 rounded-full px-1.5 text-center text-xs",
                        group.attention && group.count > 0
                          ? "bg-accent font-semibold text-accent-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {group.count}
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
          {groups.map((group) => {
            const active = group.id === value;
            return (
              <div key={group.id} className="flex shrink-0 items-center gap-2">
                {group.divider && <span className="h-6 w-px shrink-0 bg-border" aria-hidden />}
                <button
                  type="button"
                  onClick={() => onChange(group.id)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                    active
                      ? "border-accent bg-secondary font-semibold text-foreground"
                      : "border-border bg-card text-foreground/85",
                  )}
                >
                  {group.label}
                  <span
                    className={cn(
                      "numeric rounded-full px-1.5 text-xs",
                      group.attention && group.count > 0
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {group.count}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        {children}
      </div>
    </div>
  );
}
