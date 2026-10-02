import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SortDirection = "desc" | "asc";

/**
 * מקבץ רשימה של פריטים בעלי תאריך לפי שנה, עם בחירת סדר (חדש→ישן או
 * ישן→חדש). משמש בתיק הלקוח ובעמוד "ההזמנות שלי".
 */
export function groupByYear<T>(items: T[], getDate: (item: T) => string, direction: SortDirection) {
  const sorted = [...items].sort((a, b) => {
    const delta = new Date(getDate(a)).getTime() - new Date(getDate(b)).getTime();
    return direction === "desc" ? -delta : delta;
  });
  const groups = new Map<number, T[]>();
  for (const item of sorted) {
    const year = new Date(getDate(item)).getFullYear();
    const bucket = groups.get(year);
    if (bucket) bucket.push(item);
    else groups.set(year, [item]);
  }
  return [...groups.entries()].map(([year, entries]) => ({ year, items: entries }));
}

export function SortToggle({
  direction,
  onChange,
}: {
  direction: SortDirection;
  onChange: (next: SortDirection) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => onChange(direction === "desc" ? "asc" : "desc")}
      aria-label="שינוי סדר המיון לפי תאריך"
    >
      {direction === "desc" ? (
        <ArrowDownWideNarrow className="size-4" />
      ) : (
        <ArrowUpNarrowWide className="size-4" />
      )}
      {direction === "desc" ? "מהחדש לישן" : "מהישן לחדש"}
    </Button>
  );
}

/** רשימה מקובצת לפי שנה, עם כותרת שנה וספירה לכל קבוצה */
export function OrdersByYear<T>({
  items,
  getDate,
  renderItem,
  emptyText,
  initialDirection = "desc",
}: {
  items: T[];
  getDate: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  emptyText: string;
  initialDirection?: SortDirection;
}) {
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const groups = useMemo(() => groupByYear(items, getDate, direction), [items, getDate, direction]);

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {items.length} הזמנות · {groups.length} שנים
        </span>
        <SortToggle direction={direction} onChange={setDirection} />
      </div>
      {groups.map((group) => (
        <section key={group.year} className="space-y-2">
          <h4 className="numeric flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="font-display text-base">{group.year}</span>
            <span className="text-xs font-normal text-muted-foreground">
              ({group.items.length})
            </span>
            <span className="h-px flex-1 bg-border" />
          </h4>
          <div className="space-y-2">{group.items.map(renderItem)}</div>
        </section>
      ))}
    </div>
  );
}
